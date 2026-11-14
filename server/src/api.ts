/*
The sync HTTP API, independent of the runtime. `node.ts` serves it in the Docker image and `worker.ts` inside the
library's Durable Object on Cloudflare. Live updates (the WebSocket) are runtime specific and live in those files;
this module only reports the new cursor after a push changed something.
*/
import {Hono, type MiddlewareHandler} from 'hono';
import {bearerAuth} from 'hono/bearer-auth';
import {bodyLimit} from 'hono/body-limit';
import {except} from 'hono/combine';
import {compress} from 'hono/compress';
import {cors} from 'hono/cors';
import {PROTOCOL_VERSION, type SyncLog} from '../../src/shared/sync/change-log';
import {parseChange, type SyncChange} from '../../src/shared/sync/changes';
import {LIVE_PATH} from './live';
import {
	fetchIcon,
	fetchPreview,
	type Preview,
	type PreviewDeps,
} from './preview';

/**
The extension calls the server from its own origin. CORS lets it do that without asking the browser for access to
the server's site; the token, not the origin, is what protects the library. WebSockets are not subject to CORS.
*/
export const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Authorization, Content-Type',
	'Access-Control-Max-Age': '86400',
};
export const MIN_TOKEN_LENGTH = 32;

export type Limits = {
	/**
	Records a library may hold, tombstones included.
	*/
	maxRecords: number;
	/**
	Days a delete is remembered so offline devices learn about it.
	*/
	retentionDays: number;
	/**
	Authenticated requests per minute. One person's devices stay far below it; it stops a runaway client from
	running up the server's cost.
	*/
	requestsPerMinute: number;
};

export const DEFAULT_LIMITS: Limits = {
	maxRecords: 500_000,
	retentionDays: 90,
	requestsPerMinute: 300,
};
const MINUTE_MS = 60 * 1000;

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PUSH_CHANGES = 500;
const MAX_CHANGE_BYTES = 256 * 1024;
const MAX_KEY_CHARS = 4096;
/**
Optional parts of the API, listed in /v1/status so a device can tell what this server supports. `private` is the
second library at /private for private windows; `key` is /v1/key.
*/
const FEATURES = ['private', 'key', 'preview'];
const PREVIEWS_PER_MINUTE = 600;
const PREVIEW_CACHE_SIZE = 500;
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
export const PRIVATE_PREFIX = '/private';
const DEFAULT_PULL = 500;
const MAX_PULL = 1000;
const PURGE_EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ApiOptions = {
	token: string;
	log: () => SyncLog;
	limits?: Partial<Limits>;
	/**
	Called after a push applied at least one change, with the new cursor.
	*/
	onApplied?: (cursor: number) => void;
	now?: () => number;
	/**
	Gzip answers. The Docker server turns it on; Cloudflare compresses at its edge already.
	*/
	compress?: boolean;
	/**
	How the server reaches other sites for /v1/icon and /v1/preview.
	*/
	preview?: PreviewDeps;
};

const problem = (error: string, detail?: Record<string, unknown>) => ({
	error,
	...detail,
});

export function createApi(options: ApiOptions) {
	const limits = {...DEFAULT_LIMITS, ...options.limits};
	const now = options.now ?? Date.now;
	let lastPurge = 0;

	const app = new Hono();
	if (options.compress) {
		// Pull pages compress to a fraction of their size.
		app.use('*', compress());
	}

	app.use(
		'*',
		cors({
			origin: '*',
			allowMethods: ['GET', 'POST', 'OPTIONS'],
			allowHeaders: ['Authorization', 'Content-Type'],
			maxAge: 86_400,
		}),
	);
	app.get('/health', (c) => c.json({ok: true}));
	// The live channel authenticates in its first message; see live.ts.
	const unauthorized = {error: 'unauthorized'};
	app.use(
		'/v1/*',
		except(
			LIVE_PATH,
			bearerAuth({
				token: options.token,
				noAuthenticationHeader: {message: unauthorized},
				invalidAuthenticationHeader: {message: unauthorized},
				invalidToken: {message: unauthorized},
			}),
		),
	);

	// A fixed one minute window per server, which serves one library. Counted after the token check, so only the
	// owner's devices can use it up.
	let rateWindow = {start: 0, count: 0};
	app.use('/v1/*', async (c, next) => {
		if (c.req.path === '/v1/icon' || c.req.path === '/v1/preview') {
			return next();
		}

		const time = now();
		if (time - rateWindow.start >= MINUTE_MS) {
			rateWindow = {start: time, count: 0};
		}

		rateWindow.count += 1;
		if (rateWindow.count > limits.requestsPerMinute) {
			const retryAfter = Math.ceil(
				(rateWindow.start + MINUTE_MS - time) / 1000,
			);
			c.header('Retry-After', String(retryAfter));
			return c.json(problem('rate_limited', {retryAfter}), 429);
		}

		await next();
	});

	// Icons and previews have their own allowance: a screen of links asks for a dozen at once, and they must not use
	// up the library's.
	let previewWindow = {start: 0, count: 0};
	const cache = new Map<string, {at: number; value: unknown}>();
	const remember = (key: string, value: unknown) => {
		cache.delete(key);
		cache.set(key, {at: now(), value});
		if (cache.size > PREVIEW_CACHE_SIZE) {
			cache.delete(cache.keys().next().value!);
		}
	};

	const cached = (key: string) => {
		const hit = cache.get(key);
		return hit && now() - hit.at < PREVIEW_TTL_MS ? hit : undefined;
	};

	const previewLimit: MiddlewareHandler = async (c, next) => {
		const time = now();
		if (time - previewWindow.start >= MINUTE_MS) {
			previewWindow = {start: time, count: 0};
		}

		previewWindow.count += 1;
		return previewWindow.count > PREVIEWS_PER_MINUTE
			? c.json(problem('rate_limited'), 429)
			: next();
	};

	app.use('/v1/icon', previewLimit);
	app.use('/v1/preview', previewLimit);

	app.get('/v1/icon', async (c) => {
		const host = (c.req.query('host') ?? '').toLowerCase();
		if (!/^[\d\-.a-z]{3,253}$/.test(host)) {
			return c.json(problem('bad_host'), 400);
		}

		const key = `icon:${host}`;
		const hit = cached(key);
		const icon =
			(hit?.value as {bytes: Uint8Array; type: string} | null | undefined) ??
			(await fetchIcon(host, options.preview));
		if (!hit) {
			remember(key, icon ?? null);
		}

		if (!icon) {
			c.header('Cache-Control', 'private, max-age=86400');
			return c.json(problem('no_icon'), 404);
		}

		return c.body(new Uint8Array(icon.bytes), 200, {
			'Content-Type': icon.type,
			'Cache-Control': 'private, max-age=604800',
			'X-Content-Type-Options': 'nosniff',
		});
	});

	app.get('/v1/preview', async (c) => {
		const url = c.req.query('url') ?? '';
		if (url.length === 0 || url.length > 2048) {
			return c.json(problem('bad_url'), 400);
		}

		const key = `page:${url}`;
		const hit = cached(key);
		const preview =
			(hit?.value as Preview | null | undefined) ??
			(await fetchPreview(url, options.preview));
		if (!hit) {
			remember(key, preview ?? null);
		}

		if (!preview) {
			return c.json(problem('no_preview'), 404);
		}

		c.header('Cache-Control', 'private, max-age=86400');
		return c.json(preview);
	});

	app.get('/v1/status', (c) => {
		const log = options.log();
		return c.json({
			protocol: PROTOCOL_VERSION,
			cursor: log.cursor,
			records: log.size,
			limits,
			features: FEATURES,
		});
	});

	app.get('/v1/key', (c) => c.json({key: options.log().key}));

	app.post(
		'/v1/key',
		bodyLimit({
			maxSize: MAX_KEY_CHARS * 2,
			onError: (c) => c.json(problem('too_large'), 413),
		}),
		async (c) => {
			let body: unknown;
			try {
				body = await c.req.json();
			} catch {
				return c.json(problem('bad_json'), 400);
			}

			const {key, previous} = (body ?? {}) as {
				key?: unknown;
				previous?: unknown;
			};
			if (
				typeof key !== 'string' ||
				key === '' ||
				key.length > MAX_KEY_CHARS ||
				!(previous === null || typeof previous === 'string')
			) {
				return c.json(problem('bad_key'), 400);
			}

			const log = options.log();
			return log.replaceKey(key, previous)
				? c.json({key})
				: c.json(problem('key_changed', {key: log.key}), 409);
		},
	);

	app.get('/v1/changes', (c) => {
		const cursor = Number(c.req.query('cursor') ?? 0);
		const limit = Number(c.req.query('limit') ?? DEFAULT_PULL);
		const seen = Number(c.req.query('purged') ?? 0);
		if (
			[cursor, seen].some(
				(value) => !(Number.isSafeInteger(value) && value >= 0),
			)
		) {
			return c.json(problem('bad_cursor'), 400);
		}

		return !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PULL
			? c.json(problem('bad_limit', {max: MAX_PULL}), 400)
			: c.json(options.log().pull(cursor, limit, seen));
	});

	app.post(
		'/v1/changes',
		bodyLimit({
			maxSize: MAX_BODY_BYTES,
			onError: (c) =>
				c.json(problem('too_large', {maxBytes: MAX_BODY_BYTES}), 413),
		}),
		async (c) => {
			let body: unknown;
			try {
				body = await c.req.json();
			} catch {
				return c.json(problem('bad_json'), 400);
			}

			const raw = (body as {changes?: unknown} | null)?.changes;
			if (!Array.isArray(raw) || raw.length > MAX_PUSH_CHANGES) {
				return c.json(problem('bad_changes', {max: MAX_PUSH_CHANGES}), 400);
			}

			const changes: SyncChange[] = [];
			for (const [index, entry] of raw.entries()) {
				const change = parseChange(entry);
				if (!change) {
					return c.json(problem('bad_change', {index}), 400);
				}

				if (JSON.stringify(change).length > MAX_CHANGE_BYTES) {
					return c.json(
						problem('change_too_large', {index, maxBytes: MAX_CHANGE_BYTES}),
						413,
					);
				}

				changes.push(change);
			}

			const log = options.log();
			const time = now();
			if (time - lastPurge > PURGE_EVERY_MS) {
				lastPurge = time;
				log.purge(time - limits.retentionDays * DAY_MS);
			}

			// Checked before the push, so one push can go over the limit by at most its own size. A full library
			// still takes deletes, which free space once their tombstones are purged.
			if (
				log.size >= limits.maxRecords &&
				changes.some((change) => !change.deleted)
			) {
				return c.json(problem('quota', {maxRecords: limits.maxRecords}), 507);
			}

			const before = log.cursor;
			const results = log.push(changes, time);
			const {cursor} = log;
			if (cursor !== before) {
				options.onApplied?.(cursor);
			}

			return c.json({results, cursor});
		},
	);

	return app;
}
