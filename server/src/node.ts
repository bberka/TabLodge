/*
The Docker server: the sync API on Node with the library in one SQLite file.

Environment:
	TABLODGE_SYNC_TOKEN   required, at least 32 characters; devices send it as the bearer token
	PORT                  default 8787
	DATA_DIR              default ./data; holds library.db
	MAX_RECORDS           default 500000
	RETENTION_DAYS        default 90
	RATE_LIMIT_PER_MINUTE default 300; requests per minute before the server answers 429

Commands, run inside the container with `docker exec`:
	node node.js export   writes the library to stdout as JSON lines (a backup)
	node node.js import   reads such a file from stdin into the server
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
	LIVE_AUTH_TIMEOUT_MS,
	LIVE_MAX_SOCKETS,
	LIVE_PATH,
	LIVE_PING,
	LIVE_PONG,
	LIVE_UNAUTHORIZED,
	readyMessage,
} from './live';
import {sqlite} from './node-sqlite';
import {SqlChangeLog} from './sql-change-log';
import {runTransfer} from './transfer';

function positive(name: string, fallback: number): number {
	const raw = process.env[name];
	const value = raw === undefined ? fallback : Number(raw);
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive whole number`);
	}

	return value;
}

/**
Starts the server; runs until the container stops.
*/
function startServer() {
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
	// Sockets that have not authenticated yet, with the timer that closes them.
	const waiting = new Map<WSContext, ReturnType<typeof setTimeout>>();
	let openSockets = 0;

	const app = createApi({
		token,
		compress: true,
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
			onOpen(_event, socket) {
				openSockets += 1;
				if (openSockets > LIVE_MAX_SOCKETS) {
					socket.close(1013, 'too many connections');
					return;
				}

				waiting.set(
					socket,
					setTimeout(() => {
						socket.close(LIVE_UNAUTHORIZED, 'unauthorized');
					}, LIVE_AUTH_TIMEOUT_MS),
				);
			},
			onMessage(event, socket) {
				if (event.data === LIVE_PING) {
					socket.send(LIVE_PONG);
				} else if (sockets.has(socket)) {
					// Authenticated devices have nothing else to say.
				} else if (isAuthMessage(event.data, token)) {
					clearTimeout(waiting.get(socket));
					waiting.delete(socket);
					sockets.add(socket);
					socket.send(readyMessage(log.cursor));
				} else {
					socket.close(LIVE_UNAUTHORIZED, 'unauthorized');
				}
			},
			onClose(_event, socket) {
				openSockets -= 1;
				clearTimeout(waiting.get(socket));
				waiting.delete(socket);
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
}

// `node node.js export` and `node node.js import` copy the library out of or into this server (see transfer.ts).
const command = process.argv[2];
if (command === 'export' || command === 'import') {
	try {
		await runTransfer(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
} else if (command === undefined) {
	startServer();
} else {
	console.error(
		'Usage: node node.js            start the server\n       node node.js export     write the library to stdout\n       node node.js import     read an export from stdin into the server',
	);
	process.exitCode = 1;
}
