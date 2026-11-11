/*
The sync HTTP API, independent of the runtime. `node.ts` serves it in the Docker image and `worker.ts` inside the
library's Durable Object on Cloudflare. Live updates (the WebSocket) are runtime specific and live in those files;
this module only reports the new cursor after a push changed something.
*/
import {Hono} from 'hono';
import {bearerAuth} from 'hono/bearer-auth';
import {bodyLimit} from 'hono/body-limit';
import {except} from 'hono/combine';
import {cors} from 'hono/cors';
import type {SyncLog} from '../../src/shared/sync/change-log';
import {parseChange, type SyncChange} from '../../src/shared/sync/changes';
import {LIVE_PATH} from './live';

export const PROTOCOL_VERSION = 1;

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
};

export const DEFAULT_LIMITS: Limits = {maxRecords: 500_000, retentionDays: 90};

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PUSH_CHANGES = 500;
const MAX_CHANGE_BYTES = 256 * 1024;
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

	app.get('/v1/status', (c) => {
		const log = options.log();
		return c.json({
			protocol: PROTOCOL_VERSION,
			cursor: log.cursor,
			records: log.size,
			limits,
		});
	});

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
