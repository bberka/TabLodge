/*
The Docker server: the sync API on Node with the library in one SQLite file.

Environment:
	TABLODGE_SYNC_TOKEN   required, at least 32 characters; devices send it as the bearer token
	PORT                  default 8787
	DATA_DIR              default ./data; holds library.db
	MAX_RECORDS           default 500000
	RETENTION_DAYS        default 90
	RATE_LIMIT_PER_MINUTE default 300; requests per minute before the server answers 429
*/
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import process from 'node:process';
import {serve} from '@hono/node-server';
import {createNodeWebSocket} from '@hono/node-ws';
import type {WSContext} from 'hono/ws';
import {createApi, DEFAULT_LIMITS, MIN_TOKEN_LENGTH} from './api';
import {
	cursorMessage,
	isAuthMessage,
	LIVE_PATH,
	LIVE_PING,
	LIVE_PONG,
	LIVE_UNAUTHORIZED,
	readyMessage,
} from './live';
import {sqlite} from './node-sqlite';
import {SqlChangeLog} from './sql-change-log';

function positive(name: string, fallback: number): number {
	const raw = process.env[name];
	const value = raw === undefined ? fallback : Number(raw);
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive whole number`);
	}

	return value;
}

const token = process.env.TABLODGE_SYNC_TOKEN ?? '';
if (token.length < MIN_TOKEN_LENGTH) {
	console.error(
		`TABLODGE_SYNC_TOKEN must be set to at least ${MIN_TOKEN_LENGTH} characters. Generate one with: openssl rand -base64 32`,
	);
	process.exit(1);
}

const dataDirectory = process.env.DATA_DIR ?? 'data';
mkdirSync(dataDirectory, {recursive: true});
const log = new SqlChangeLog(sqlite(join(dataDirectory, 'library.db')));
const sockets = new Set<WSContext>();

const app = createApi({
	token,
	log: () => log,
	limits: {
		maxRecords: positive('MAX_RECORDS', DEFAULT_LIMITS.maxRecords),
		retentionDays: positive('RETENTION_DAYS', DEFAULT_LIMITS.retentionDays),
		requestsPerMinute: positive(
			'RATE_LIMIT_PER_MINUTE',
			DEFAULT_LIMITS.requestsPerMinute,
		),
	},
	onApplied(cursor) {
		for (const socket of sockets) {
			socket.send(cursorMessage(cursor));
		}
	},
});

const {injectWebSocket, upgradeWebSocket} = createNodeWebSocket({app});
app.get(
	LIVE_PATH,
	upgradeWebSocket(() => ({
		onMessage(event, socket) {
			if (event.data === LIVE_PING) {
				socket.send(LIVE_PONG);
			} else if (sockets.has(socket)) {
				// Authenticated devices have nothing else to say.
			} else if (isAuthMessage(event.data, token)) {
				sockets.add(socket);
				socket.send(readyMessage(log.cursor));
			} else {
				socket.close(LIVE_UNAUTHORIZED, 'unauthorized');
			}
		},
		onClose(_event, socket) {
			sockets.delete(socket);
		},
	})),
);

const port = positive('PORT', 8787);
const server = serve({fetch: app.fetch, port}, () => {
	console.log(`TabLodge sync server listening on port ${port}`);
});
injectWebSocket(server);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		server.close();
		process.exit(0);
	});
}
