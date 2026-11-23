import {escapeHtml} from '../../extension/src/shared/escape-html';
import {
	isSharedPageMode,
	SHARED_PAGE_PASSWORD_HEADER,
	SHARED_PAGE_PREFIX,
	type SharedPageMode,
} from '../../extension/src/shared/sync/shared-pages';
import {sameToken} from './live';
import type {Sql} from './sql-change-log';

export const PAGE_HEADERS = {
	'Content-Type': 'text/html; charset=utf-8',
	'Content-Security-Policy':
		"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-popups allow-popups-to-escape-sandbox",
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
	'X-Robots-Tag': 'noindex, nofollow',
	'Cache-Control': 'no-store',
};

export const PASSWORD_PROMPT_HEADERS = {
	'Content-Type': 'text/html; charset=utf-8',
	'Content-Security-Policy':
		"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
	'X-Robots-Tag': 'noindex, nofollow',
	'Cache-Control': 'no-store',
	[SHARED_PAGE_PASSWORD_HEADER]: '1',
};

const HASH_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const PROMPT_STYLE =
	'*{box-sizing:border-box}:root{color-scheme:light dark;--bg:#f6f7fb;--card:#fff;--text:#1f2433;--muted:#5c6375;--line:#e2e5ee;--accent:#4f46c8;--on-accent:#fff;--danger:#b91c1c}@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1a1d25;--text:#e8eaf0;--muted:#a6acba;--line:#2d313d;--accent:#aba5ff;--on-accent:#15132e;--danger:#f87171}}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{width:min(420px,100%);padding:24px;border:1px solid var(--line);border-radius:14px;background:var(--card)}h1{margin:0 0 8px;font-size:20px;line-height:1.3}p{margin:0 0 16px;color:var(--muted)}p.error{color:var(--danger);font-weight:500}label{display:block;margin:0 0 6px;font-size:14px;font-weight:600}input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button{margin-top:14px;width:100%;padding:10px 16px;border:0;border-radius:999px;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:600;cursor:pointer}';

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
		'',
	);
}

function fromHex(encoded: string): Uint8Array<ArrayBuffer> | undefined {
	if (
		encoded.length === 0 ||
		encoded.length % 2 !== 0 ||
		!/^[\da-f]+$/i.test(encoded)
	) {
		return undefined;
	}

	const bytes = new Uint8Array(new ArrayBuffer(encoded.length / 2));
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(encoded.slice(index * 2, index * 2 + 2), 16);
	}

	return bytes;
}

async function deriveKeyHash(
	secret: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number,
): Promise<string> {
	const encoded = new TextEncoder().encode(secret.normalize('NFKC'));
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoded,
		'PBKDF2',
		false,
		['deriveBits'],
	);
	const derived = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt,
			iterations,
		},
		keyMaterial,
		KEY_BITS,
	);
	return toHex(new Uint8Array(derived));
}

export async function hashPagePassword(secret: string): Promise<string> {
	const salt = crypto.getRandomValues(
		new Uint8Array(new ArrayBuffer(SALT_BYTES)),
	);
	const derived = await deriveKeyHash(secret, salt, HASH_ITERATIONS);
	return `pbkdf2$${HASH_ITERATIONS}$${toHex(salt)}$${derived}`;
}

export async function verifyPagePassword(
	secret: string,
	storedHash: string,
): Promise<boolean> {
	const parts = storedHash.split('$');
	if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
		return false;
	}

	const iterations = Number(parts[1]);
	const salt = fromHex(parts[2]);
	const expected = parts[3];
	if (
		!Number.isSafeInteger(iterations) ||
		iterations < 1 ||
		!salt ||
		expected === ''
	) {
		return false;
	}

	const actual = await deriveKeyHash(secret, salt, iterations);
	return sameToken(actual, expected);
}

export function passwordPromptHtml(id: string, wrongPassword: boolean): string {
	const action = `${SHARED_PAGE_PREFIX}${encodeURIComponent(id)}`;
	const error = wrongPassword
		? '<p class="error" role="alert">Incorrect password. Try again.</p>'
		: '';
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Password required</title><style>${PROMPT_STYLE}</style><body><main><h1>Password required</h1><p>Enter the password to view this shared page.</p>${error}<form method="post" action="${escapeHtml(action)}"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Unlock</button></form></main></body></html>`;
}

export const pageNotFound = () =>
	new Response('Not found', {
		status: 404,
		headers: {...PAGE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8'},
	});

export type StoredPage = {
	id: string;
	title: string;
	size: number;
	createdAt: number;
	updatedAt: number;
	source: string;
	mode: SharedPageMode;
	hasPassword: boolean;
};

function rowToStoredPage(
	row: Record<string, string | number | null>,
): StoredPage {
	const createdAt = Number(row.created);
	const updated = Number(row.updated);
	return {
		id: String(row.id),
		title: String(row.title),
		size: Number(row.size),
		createdAt,
		updatedAt: updated > 0 ? updated : createdAt,
		source: String(row.source ?? ''),
		mode: isSharedPageMode(row.mode) ? row.mode : 'snapshot',
		hasPassword: String(row.password_hash ?? '') !== '',
	};
}

export class SqlPageStore {
	constructor(private readonly sql: Sql) {
		sql.all(`CREATE TABLE IF NOT EXISTS pages (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			html TEXT NOT NULL,
			size INTEGER NOT NULL,
			created INTEGER NOT NULL
		)`);
		try {
			sql.all('SELECT source FROM pages LIMIT 0');
		} catch {
			sql.all("ALTER TABLE pages ADD COLUMN source TEXT NOT NULL DEFAULT ''");
		}

		try {
			sql.all('SELECT mode FROM pages LIMIT 0');
		} catch {
			sql.all(
				"ALTER TABLE pages ADD COLUMN mode TEXT NOT NULL DEFAULT 'snapshot'",
			);
		}

		try {
			sql.all('SELECT password_hash FROM pages LIMIT 0');
		} catch {
			sql.all(
				"ALTER TABLE pages ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''",
			);
		}

		try {
			sql.all('SELECT updated FROM pages LIMIT 0');
		} catch {
			sql.all(
				'ALTER TABLE pages ADD COLUMN updated INTEGER NOT NULL DEFAULT 0',
			);
		}
	}

	add(
		page: StoredPage & {html: string; passwordHash?: string},
		budget: {maxPages: number; maxBytes: number},
	): 'added' | 'taken' | 'full' {
		return this.sql.transaction(() => {
			if (
				this.sql.all('SELECT 1 FROM pages WHERE id = ?', page.id).length > 0
			) {
				return 'taken';
			}

			const used = this.sql.all(
				'SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM pages',
			)[0];
			if (
				Number(used?.n) >= budget.maxPages ||
				Number(used?.bytes) + page.size > budget.maxBytes
			) {
				return 'full';
			}

			this.sql.all(
				'INSERT INTO pages (id, title, html, size, created, source, mode, password_hash, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
				page.id,
				page.title,
				page.html,
				page.size,
				page.createdAt,
				page.source,
				page.mode,
				page.passwordHash ?? '',
				page.updatedAt,
			);
			return 'added';
		});
	}

	update(
		id: string,
		next: {title: string; html: string; size: number; updatedAt: number},
		budget: {maxBytes: number},
	):
		| {status: 'updated'; page: StoredPage}
		| {status: 'not_found' | 'not_live' | 'full'} {
		return this.sql.transaction<
			| {status: 'updated'; page: StoredPage}
			| {status: 'not_found' | 'not_live' | 'full'}
		>(() => {
			const existing = this.sql.all(
				'SELECT id, title, size, created, source, mode, password_hash, updated FROM pages WHERE id = ?',
				id,
			)[0];
			if (!existing) {
				return {status: 'not_found'};
			}

			if (existing.mode !== 'live') {
				return {status: 'not_live'};
			}

			const used = this.sql.all(
				'SELECT COALESCE(SUM(size), 0) AS bytes FROM pages',
			)[0];
			const totalWithoutThis = Number(used?.bytes) - Number(existing.size);
			if (totalWithoutThis + next.size > budget.maxBytes) {
				return {status: 'full'};
			}

			this.sql.all(
				'UPDATE pages SET title = ?, html = ?, size = ?, updated = ? WHERE id = ?',
				next.title,
				next.html,
				next.size,
				next.updatedAt,
				id,
			);
			return {
				status: 'updated',
				page: rowToStoredPage({
					...existing,
					title: next.title,
					size: next.size,
					updated: next.updatedAt,
				}),
			};
		});
	}

	list(): StoredPage[] {
		return this.sql
			.all(
				'SELECT id, title, size, created, source, mode, password_hash, updated FROM pages ORDER BY created DESC',
			)
			.map((row) => rowToStoredPage(row));
	}

	html(id: string): string | undefined {
		const row = this.sql.all('SELECT html FROM pages WHERE id = ?', id)[0];
		return row ? String(row.html) : undefined;
	}

	view(id: string): {html: string; passwordHash: string} | undefined {
		const row = this.sql.all(
			'SELECT html, password_hash FROM pages WHERE id = ?',
			id,
		)[0];
		return row
			? {
					html: String(row.html),
					passwordHash: String(row.password_hash ?? ''),
				}
			: undefined;
	}

	remove(id: string): boolean {
		const removed =
			this.sql.all('DELETE FROM pages WHERE id = ? RETURNING id', id).length >
			0;
		if (removed) {
			this.sql.compact?.();
		}

		return removed;
	}
}
