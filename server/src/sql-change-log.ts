/*
The change log over SQLite, with the rules of the in memory `ChangeLog` in src/shared/sync/change-log.ts. Both
runtimes have synchronous SQLite: `node:sqlite` in the Docker server and the storage of a Durable Object on
Cloudflare, so one implementation serves both through the small `Sql` interface.
*/
import {
	pushResult,
	type PullResponse,
	type PushResult,
	type SyncLog,
} from '../../src/shared/sync/change-log';
import {
	parseChange,
	recordKey,
	type SyncChange,
} from '../../src/shared/sync/changes';
import {stampAt} from '../../src/shared/sync/clock';

export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

export type Sql = {
	all(query: string, ...parameters: SqlValue[]): SqlRow[];
	/**
	Runs `work` so that either all of its writes happen or none do.
	*/
	transaction<T>(work: () => T): T;
};

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS records (
		key TEXT PRIMARY KEY,
		seq INTEGER NOT NULL UNIQUE,
		h TEXT NOT NULL,
		deleted INTEGER NOT NULL,
		change TEXT NOT NULL
	)`,
	'CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)',
];

export class SqlChangeLog implements SyncLog {
	constructor(private readonly sql: Sql) {
		for (const statement of SCHEMA) {
			sql.all(statement);
		}
	}

	private meta(name: string): string | undefined {
		const value = this.sql.all('SELECT value FROM meta WHERE name = ?', name)[0]
			?.value;
		return value === undefined || value === null ? undefined : String(value);
	}

	private setMeta(name: string, value: string) {
		this.sql.all(
			'INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value',
			name,
			value,
		);
	}

	get cursor() {
		return Number(this.meta('seq') ?? 0);
	}

	get size() {
		return Number(this.sql.all('SELECT COUNT(*) AS n FROM records')[0].n);
	}

	push(changes: readonly SyncChange[], now: number): PushResult[] {
		return this.sql.transaction(() => {
			let seq = this.cursor;
			const purgedH = this.meta('purgedH') ?? '';
			const results = changes.map((change) => {
				const key = recordKey(change);
				const row = this.sql.all(
					'SELECT change FROM records WHERE key = ?',
					key,
				)[0];
				const current = row ? readChange(row) : undefined;
				const result = pushResult(change, current, purgedH, now);
				if (result === 'applied') {
					seq += 1;
					this.sql.all(
						`INSERT INTO records (key, seq, h, deleted, change) VALUES (?, ?, ?, ?, ?)
						ON CONFLICT (key) DO UPDATE SET seq = excluded.seq, h = excluded.h,
							deleted = excluded.deleted, change = excluded.change`,
						key,
						seq,
						change.h,
						change.deleted ? 1 : 0,
						JSON.stringify(change),
					);
				}

				return result;
			});
			this.setMeta('seq', String(seq));
			return results;
		});
	}

	pull(cursor: number, limit: number): PullResponse {
		if (cursor > 0 && cursor < Number(this.meta('purgedSeq') ?? 0)) {
			return {resync: true};
		}

		const rows = this.sql.all(
			'SELECT seq, change FROM records WHERE seq > ? ORDER BY seq LIMIT ?',
			cursor,
			limit + 1,
		);
		const page = rows.slice(0, limit);
		return {
			resync: false,
			changes: page.flatMap((row) => readChange(row) ?? []),
			cursor:
				page.length > 0
					? Number(page.at(-1)!.seq)
					: Math.max(cursor, this.cursor),
			more: rows.length > limit,
		};
	}

	purge(before: number) {
		this.sql.transaction(() => {
			const [purged] = this.sql.all(
				'SELECT MAX(seq) AS seq, MAX(h) AS h FROM records WHERE deleted = 1 AND h < ?',
				stampAt(before),
			);
			if (purged?.seq === null || purged?.seq === undefined) {
				return;
			}

			this.sql.all(
				'DELETE FROM records WHERE deleted = 1 AND h < ?',
				stampAt(before),
			);
			this.setMeta(
				'purgedSeq',
				String(
					Math.max(Number(this.meta('purgedSeq') ?? 0), Number(purged.seq)),
				),
			);
			if (String(purged.h) > (this.meta('purgedH') ?? '')) {
				this.setMeta('purgedH', String(purged.h));
			}
		});
	}
}

/**
A stored change, checked again so a damaged row is skipped instead of sent to devices.
*/
function readChange(row: SqlRow): SyncChange | undefined {
	try {
		return parseChange(JSON.parse(String(row.change)));
	} catch {
		return undefined;
	}
}
