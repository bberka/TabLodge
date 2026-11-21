/*
Shared pages over SQLite, in a table next to the change log of the main library. A page is kept as the bytes the
device sent: the server never parses it or the library's records (ADR 1). The headers below, not the page, decide
what a browser may do with it, so even a hand made upload cannot run script on the server's address.
*/
import type {Sql} from './sql-change-log';

export const PAGE_HEADERS = {
	'Content-Type': 'text/html; charset=utf-8',
	// `sandbox` gives the page an opaque origin and no scripts; popups are allowed so its links open in a new tab,
	// outside the sandbox.
	'Content-Security-Policy':
		"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-popups allow-popups-to-escape-sandbox",
	'X-Content-Type-Options': 'nosniff',
	// Otherwise every site a visitor opens from the page learns its address.
	'Referrer-Policy': 'no-referrer',
	'X-Robots-Tag': 'noindex, nofollow',
	// A deleted page must stop showing at once.
	'Cache-Control': 'no-store',
};

/**
The one answer for an id that is malformed, unknown, or deleted, so none can be told apart.
*/
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
	source: string;
};

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
	}

	/**
	Adds the page unless its id is taken, the server already holds `maxPages` pages, or the page would take the total
	over `maxBytes`.
	*/
	add(
		page: StoredPage & {html: string},
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
				'INSERT INTO pages (id, title, html, size, created, source) VALUES (?, ?, ?, ?, ?, ?)',
				page.id,
				page.title,
				page.html,
				page.size,
				page.createdAt,
				page.source,
			);
			return 'added';
		});
	}

	list(): StoredPage[] {
		return this.sql
			.all(
				'SELECT id, title, size, created, source FROM pages ORDER BY created DESC',
			)
			.map((row) => ({
				id: String(row.id),
				title: String(row.title),
				size: Number(row.size),
				createdAt: Number(row.created),
				source: String(row.source ?? ''),
			}));
	}

	html(id: string): string | undefined {
		const row = this.sql.all('SELECT html FROM pages WHERE id = ?', id)[0];
		return row ? String(row.html) : undefined;
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
