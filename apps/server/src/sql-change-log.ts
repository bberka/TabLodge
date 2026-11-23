import {
	mustResync,
	pushResult,
	type PullResponse,
	type PushResult,
	type SyncLog,
} from '../../extension/src/shared/sync/change-log';
import {
	parseChange,
	recordKey,
	type SyncChange,
} from '../../extension/src/shared/sync/changes';
import {stampAt} from '../../extension/src/shared/sync/clock';

export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

export type Sql = {
	all(query: string, ...parameters: SqlValue[]): SqlRow[];
	transaction<T>(work: () => T): T;
	compact?(): void;
};

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS records (
		key TEXT PRIMARY KEY,
		seq INTEGER NOT NULL UNIQUE,
		h TEXT NOT NULL,
		d TEXT NOT NULL,
		deleted INTEGER NOT NULL,
		change TEXT NOT NULL
	)`,
	'CREATE INDEX IF NOT EXISTS records_tombstones ON records (h) WHERE deleted = 1',
	'CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)',
];

const numberOf = (value: SqlValue | undefined) => Number(value ?? 0);

export class SqlChangeLog implements SyncLog {
	private seq: number;
	private purgedSeq: number;
	private purgedH: string;
	private count: number;
	private storedKey: string | null;

	constructor(private readonly sql: Sql) {
		for (const statement of SCHEMA) {
			sql.all(statement);
		}

		const meta = new Map(
			sql
				.all('SELECT name, value FROM meta')
				.map((row) => [String(row.name), String(row.value)]),
		);
		this.seq = Number(meta.get('seq') ?? 0);
		this.purgedSeq = Number(meta.get('purgedSeq') ?? 0);
		this.purgedH = meta.get('purgedH') ?? '';
		this.storedKey = meta.get('key') ?? null;
		const stored = meta.get('count');
		if (stored === undefined) {
			this.count = numberOf(sql.all('SELECT COUNT(*) AS n FROM records')[0]?.n);
			this.setMeta('count', String(this.count));
		} else {
			this.count = Number(stored);
		}
	}

	private setMeta(name: string, value: string) {
		this.sql.all(
			'INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value',
			name,
			value,
		);
	}

	get cursor() {
		return this.seq;
	}

	get key() {
		return this.storedKey;
	}

	replaceKey(next: string, expected: string | null) {
		if (this.storedKey !== expected) {
			return false;
		}

		this.setMeta('key', next);
		this.storedKey = next;
		return true;
	}

	get size() {
		return this.count;
	}

	push(changes: readonly SyncChange[], now: number): PushResult[] {
		const outcome = this.sql.transaction(() => {
			let {seq} = this;
			let added = 0;
			const results = changes.map((change) => {
				const key = recordKey(change);
				const row = this.sql.all(
					'SELECT h, d FROM records WHERE key = ?',
					key,
				)[0];
				const current = row ? {h: String(row.h), d: String(row.d)} : undefined;
				const result = pushResult(change, current, this.purgedH, now);
				if (result === 'applied') {
					seq += 1;
					added += current ? 0 : 1;
					this.sql.all(
						`INSERT INTO records (key, seq, h, d, deleted, change) VALUES (?, ?, ?, ?, ?, ?)
						ON CONFLICT (key) DO UPDATE SET seq = excluded.seq, h = excluded.h, d = excluded.d,
							deleted = excluded.deleted, change = excluded.change`,
						key,
						seq,
						change.h,
						change.d,
						change.deleted ? 1 : 0,
						JSON.stringify(change),
					);
				}

				return result;
			});
			if (seq !== this.seq) {
				this.setMeta('seq', String(seq));
			}

			if (added > 0) {
				this.setMeta('count', String(this.count + added));
			}

			return {results, seq, added};
		});
		this.seq = outcome.seq;
		this.count += outcome.added;
		return outcome.results;
	}

	pull(cursor: number, limit: number, seen = 0): PullResponse {
		if (mustResync(cursor, seen, this.purgedSeq)) {
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
			cursor: page.length > 0 ? numberOf(page.at(-1)!.seq) : this.seq,
			more: rows.length > limit,
			purged: this.purgedSeq,
		};
	}

	purge(before: number) {
		const purged = this.sql.transaction(() => {
			const rows = this.sql.all(
				'DELETE FROM records WHERE deleted = 1 AND h < ? RETURNING seq, h',
				stampAt(before),
			);
			let seq = this.purgedSeq;
			let h = this.purgedH;
			for (const row of rows) {
				seq = Math.max(seq, numberOf(row.seq));
				if (String(row.h) > h) {
					h = String(row.h);
				}
			}

			if (rows.length > 0) {
				this.setMeta('purgedSeq', String(seq));
				this.setMeta('purgedH', h);
				this.setMeta('count', String(this.count - rows.length));
			}

			return {removed: rows.length, seq, h};
		});
		if (purged.removed === 0) {
			return;
		}

		this.purgedSeq = purged.seq;
		this.purgedH = purged.h;
		this.count -= purged.removed;
		this.sql.compact?.();
	}
}

function readChange(row: SqlRow): SyncChange | undefined {
	try {
		return parseChange(JSON.parse(String(row.change)));
	} catch {
		return undefined;
	}
}
