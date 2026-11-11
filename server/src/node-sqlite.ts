/*
The `Sql` interface over Node's built in SQLite, used by the Docker server and the tests.
*/
import {DatabaseSync} from 'node:sqlite';
import type {Sql, SqlValue} from './sql-change-log';

/**
Opens a database file, or an in memory database for ':memory:'.
*/
export function sqlite(path: string): Sql {
	const database = new DatabaseSync(path);
	database.exec('PRAGMA journal_mode = WAL');
	return {
		all: (query, ...parameters: SqlValue[]) =>
			database.prepare(query).all(...parameters) as Array<
				Record<string, SqlValue>
			>,
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
	};
}
