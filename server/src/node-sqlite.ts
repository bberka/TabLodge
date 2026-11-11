/*
The `Sql` interface over Node's built in SQLite, used by the Docker server and the tests. Tuned for a small server:
WAL with `synchronous = NORMAL` (safe in WAL mode, and far fewer disk flushes), a capped WAL file and page cache,
prepared statements reused, and space from purged rows handed back to the disk.
*/
import {DatabaseSync, type StatementSync} from 'node:sqlite';
import type {Sql, SqlValue} from './sql-change-log';

/**
Opens a database file, or an in memory database for ':memory:'.
*/
export function sqlite(path: string): Sql {
	const database = new DatabaseSync(path);
	// Must come before the first table is created; on an existing database it has no effect.
	database.exec('PRAGMA auto_vacuum = INCREMENTAL');
	database.exec('PRAGMA journal_mode = WAL');
	database.exec('PRAGMA synchronous = NORMAL');
	database.exec('PRAGMA journal_size_limit = 4194304');
	database.exec('PRAGMA cache_size = -4000');
	database.exec('PRAGMA temp_store = MEMORY');
	const statements = new Map<string, StatementSync>();
	const prepared = (query: string) => {
		let statement = statements.get(query);
		if (!statement) {
			statement = database.prepare(query);
			statements.set(query, statement);
		}

		return statement;
	};

	return {
		all: (query, ...parameters: SqlValue[]) =>
			prepared(query).all(...parameters) as Array<Record<string, SqlValue>>,
		transaction(work) {
			database.exec('BEGIN IMMEDIATE');
			try {
				const result = work();
				database.exec('COMMIT');
				return result;
			} catch (error) {
				database.exec('ROLLBACK');
				throw error;
			}
		},
		compact() {
			database.exec('PRAGMA incremental_vacuum');
			database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
		},
	};
}
