import {Hono, type MiddlewareHandler} from 'hono';
import {bearerAuth} from 'hono/bearer-auth';
import {bodyLimit} from 'hono/body-limit';
import {except} from 'hono/combine';
import {compress} from 'hono/compress';
import {cors} from 'hono/cors';
import {validateCredential} from '../../extension/src/shared/passcode';
import {
	PROTOCOL_VERSION,
	type SyncLog,
} from '../../extension/src/shared/sync/change-log';
import {
	parseChange,
	type SyncChange,
} from '../../extension/src/shared/sync/changes';
import {
	isSharedPageMode,
	MAX_SHARED_PAGE_SOURCE,
	MAX_SHARED_PAGE_TITLE,
	newSharedPageId,
	SHARED_PAGE_ID,
	SHARED_PAGE_IMPORT_FEATURE,
	SHARED_PAGE_LIVE_PASSWORD_FEATURE,
	SHARED_PAGE_PASSWORD_HEADER,
	SHARED_PAGE_PREFIX,
	SHARED_PAGES_FEATURE,
} from '../../extension/src/shared/sync/shared-pages';
import {version as SERVER_VERSION} from '../package.json';
import {LIVE_PATH} from './live';
import {
	fetchIcon,
	fetchPage,
	fetchPreview,
	type Preview,
	type PreviewDeps,
} from './preview';
import {
	hashPagePassword,
	PAGE_HEADERS,
	pageNotFound,
	PASSWORD_PROMPT_HEADERS,
	passwordPromptHtml,
	type SqlPageStore,
	type StoredPage,
	verifyPagePassword,
} from './shared-pages';

export const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Authorization, Content-Type',
	'Access-Control-Expose-Headers': SHARED_PAGE_PASSWORD_HEADER,
	'Access-Control-Max-Age': '86400',
};
export const MIN_TOKEN_LENGTH = 32;

export type Limits = {
	maxRecords: number;
	retentionDays: number;
	requestsPerMinute: number;
	maxPageBytes: number;
	maxPages: number;
	maxPageStorageBytes: number;
	pageViewsPerMinute: number;
};

export const DEFAULT_LIMITS: Limits = {
	maxRecords: 500_000,
	retentionDays: 90,
	requestsPerMinute: 300,
	maxPageBytes: 1_000_000,
	maxPages: 50,
	maxPageStorageBytes: 20_000_000,
	pageViewsPerMinute: 120,
};
const MINUTE_MS = 60 * 1000;

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PUSH_CHANGES = 500;
const MAX_CHANGE_BYTES = 256 * 1024;
const MAX_KEY_CHARS = 4096;
const FEATURES = [
	'private',
	'key',
	'preview',
	'trash',
	'notes',
	'tags',
	'page-source',
	'sources',
	'settings',
];
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
	onApplied?: (cursor: number) => void;
	now?: () => number;
	compress?: boolean;
	preview?: PreviewDeps;
	pages?: () => SqlPageStore;
};

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

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
		app.use('*', compress());
	}

	app.use(
		'*',
		cors({
			origin: '*',
			allowMethods: ['GET', 'POST', 'OPTIONS'],
			allowHeaders: ['Authorization', 'Content-Type'],
			exposeHeaders: [SHARED_PAGE_PASSWORD_HEADER],
			maxAge: 86_400,
		}),
	);
	app.get('/health', (c) => c.json({ok: true}));
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

	let rateWindow = {start: 0, count: 0};
	app.use('/v1/*', async (c, next) => {
		if (['/v1/icon', '/v1/preview', '/v1/page-source'].includes(c.req.path)) {
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
	app.use('/v1/page-source', previewLimit);

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

	app.get('/v1/page-source', async (c) => {
		const url = c.req.query('url') ?? '';
		if (url.length === 0 || url.length > 2048) {
			return c.json(problem('bad_url'), 400);
		}

		const page = await fetchPage(url, options.preview);
		if (!page) {
			return c.json(problem('no_page'), 404);
		}

		c.header('Cache-Control', 'no-store');
		return c.json(page);
	});

	app.get('/v1/status', (c) => {
		const log = options.log();
		return c.json({
			protocol: PROTOCOL_VERSION,
			version: SERVER_VERSION,
			cursor: log.cursor,
			records: log.size,
			limits,
			features: options.pages
				? [
						...FEATURES,
						SHARED_PAGES_FEATURE,
						SHARED_PAGE_IMPORT_FEATURE,
						SHARED_PAGE_LIVE_PASSWORD_FEATURE,
					]
				: FEATURES,
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

	const {pages} = options;
	if (pages) {
		const pageRecord = (page: StoredPage) => ({
			...page,
			path: `${SHARED_PAGE_PREFIX}${page.id}`,
		});

		app.get('/v1/pages', (c) =>
			c.json({
				pages: pages()
					.list()
					.map((page) => pageRecord(page)),
			}),
		);

		app.post(
			'/v1/pages',
			bodyLimit({
				maxSize: limits.maxPageBytes * 6 + 4096,
				onError: (c) =>
					c.json(
						problem('page_too_large', {maxBytes: limits.maxPageBytes}),
						413,
					),
			}),
			async (c) => {
				let body: unknown;
				try {
					body = await c.req.json();
				} catch {
					return c.json(problem('bad_json'), 400);
				}

				const {title, html, id, source, mode, password} = (body ?? {}) as {
					title?: unknown;
					html?: unknown;
					id?: unknown;
					source?: unknown;
					mode?: unknown;
					password?: unknown;
				};
				if (
					typeof title !== 'string' ||
					title.length > MAX_SHARED_PAGE_TITLE ||
					typeof html !== 'string' ||
					html === '' ||
					(id !== undefined &&
						(typeof id !== 'string' || !SHARED_PAGE_ID.test(id))) ||
					(source !== undefined &&
						(typeof source !== 'string' ||
							source.length > MAX_SHARED_PAGE_SOURCE)) ||
					(mode !== undefined && !isSharedPageMode(mode)) ||
					(password !== undefined && typeof password !== 'string')
				) {
					return c.json(problem('bad_page'), 400);
				}

				if (
					password !== undefined &&
					password !== '' &&
					(validateCredential(password) !== null || /[\n\r]/.test(password))
				) {
					return c.json(problem('bad_password'), 400);
				}

				const size = utf8Bytes(html);
				if (size > limits.maxPageBytes) {
					return c.json(
						problem('page_too_large', {maxBytes: limits.maxPageBytes}),
						413,
					);
				}

				const passwordHash =
					password !== undefined && password !== ''
						? await hashPagePassword(password)
						: '';
				const createdAt = now();
				const page: StoredPage = {
					id: typeof id === 'string' ? id : newSharedPageId(),
					title,
					size,
					createdAt,
					updatedAt: createdAt,
					source: typeof source === 'string' ? source : '',
					mode: isSharedPageMode(mode) ? mode : 'snapshot',
					hasPassword: passwordHash !== '',
				};
				const added = pages().add(
					{...page, html, passwordHash},
					{maxPages: limits.maxPages, maxBytes: limits.maxPageStorageBytes},
				);
				if (added === 'taken') {
					return c.json(problem('page_exists'), 409);
				}

				return added === 'added'
					? c.json(pageRecord(page), 201)
					: c.json(
							problem('pages_full', {
								maxPages: limits.maxPages,
								maxBytes: limits.maxPageStorageBytes,
							}),
							507,
						);
			},
		);

		app.post(
			'/v1/pages/:id/update',
			bodyLimit({
				maxSize: limits.maxPageBytes * 6 + 4096,
				onError: (c) =>
					c.json(
						problem('page_too_large', {maxBytes: limits.maxPageBytes}),
						413,
					),
			}),
			async (c) => {
				const id = c.req.param('id');
				if (!SHARED_PAGE_ID.test(id)) {
					return c.json(problem('not_found'), 404);
				}

				let body: unknown;
				try {
					body = await c.req.json();
				} catch {
					return c.json(problem('bad_json'), 400);
				}

				const {title, html} = (body ?? {}) as {
					title?: unknown;
					html?: unknown;
				};
				if (
					typeof title !== 'string' ||
					title.length > MAX_SHARED_PAGE_TITLE ||
					typeof html !== 'string' ||
					html === ''
				) {
					return c.json(problem('bad_page'), 400);
				}

				const size = utf8Bytes(html);
				if (size > limits.maxPageBytes) {
					return c.json(
						problem('page_too_large', {maxBytes: limits.maxPageBytes}),
						413,
					);
				}

				const result = pages().update(
					id,
					{title, html, size, updatedAt: now()},
					{maxBytes: limits.maxPageStorageBytes},
				);
				if (result.status === 'updated') {
					return c.json(pageRecord(result.page), 200);
				}

				if (result.status === 'not_found') {
					return c.json(problem('not_found'), 404);
				}

				if (result.status === 'not_live') {
					return c.json(problem('not_live'), 400);
				}

				return c.json(
					problem('pages_full', {
						maxPages: limits.maxPages,
						maxBytes: limits.maxPageStorageBytes,
					}),
					507,
				);
			},
		);

		app.post('/v1/pages/:id/delete', (c) =>
			pages().remove(c.req.param('id'))
				? c.json({deleted: true})
				: c.json(problem('not_found'), 404),
		);

		let viewWindow = {start: 0, count: 0};
		const passwordAttempts = new Map<string, {start: number; count: number}>();
		const passwordAttemptsPerMinute = 10;
		const checkViewLimit = () => {
			const time = now();
			if (time - viewWindow.start >= MINUTE_MS) {
				viewWindow = {start: time, count: 0};
			}

			viewWindow.count += 1;
			if (viewWindow.count > limits.pageViewsPerMinute) {
				return new Response('Too many requests', {
					status: 429,
					headers: {
						...PAGE_HEADERS,
						'Content-Type': 'text/plain; charset=utf-8',
						'Retry-After': String(
							Math.ceil((viewWindow.start + MINUTE_MS - time) / 1000),
						),
					},
				});
			}

			return undefined;
		};

		app.get(`${SHARED_PAGE_PREFIX}:id`, (c) => {
			const limited = checkViewLimit();
			if (limited) {
				return limited;
			}

			const id = c.req.param('id');
			const record = SHARED_PAGE_ID.test(id) ? pages().view(id) : undefined;
			if (!record) {
				return pageNotFound();
			}

			if (record.passwordHash !== '') {
				return new Response(passwordPromptHtml(id, false), {
					status: 401,
					headers: PASSWORD_PROMPT_HEADERS,
				});
			}

			return new Response(record.html, {headers: PAGE_HEADERS});
		});

		app.post(
			`${SHARED_PAGE_PREFIX}:id`,
			bodyLimit({
				maxSize: 4096,
				onError: () =>
					new Response('Request too large', {
						status: 413,
						headers: {
							...PAGE_HEADERS,
							'Content-Type': 'text/plain; charset=utf-8',
						},
					}),
			}),
			async (c) => {
				const limited = checkViewLimit();
				if (limited) {
					return limited;
				}

				const id = c.req.param('id');
				if (!SHARED_PAGE_ID.test(id)) {
					return pageNotFound();
				}

				const record = pages().view(id);
				if (!record) {
					return pageNotFound();
				}

				if (record.passwordHash === '') {
					return new Response(record.html, {headers: PAGE_HEADERS});
				}

				const time = now();
				for (const [key, entry] of passwordAttempts) {
					if (time - entry.start >= MINUTE_MS) {
						passwordAttempts.delete(key);
					}
				}

				const bucket = passwordAttempts.get(id);
				const current = bucket
					? {start: bucket.start, count: bucket.count + 1}
					: {start: time, count: 1};
				passwordAttempts.set(id, current);

				if (current.count > passwordAttemptsPerMinute) {
					return new Response('Too many requests', {
						status: 429,
						headers: {
							...PAGE_HEADERS,
							'Content-Type': 'text/plain; charset=utf-8',
							'Retry-After': String(
								Math.ceil((current.start + MINUTE_MS - time) / 1000),
							),
						},
					});
				}

				let password = '';
				try {
					const raw = await c.req.text();
					password = new URLSearchParams(raw).get('password') ?? '';
				} catch {
					password = '';
				}

				const matched =
					password !== '' &&
					(await verifyPagePassword(password, record.passwordHash));
				if (!matched) {
					return new Response(passwordPromptHtml(id, true), {
						status: 401,
						headers: PASSWORD_PROMPT_HEADERS,
					});
				}

				return new Response(record.html, {headers: PAGE_HEADERS});
			},
		);
	}

	return app;
}
