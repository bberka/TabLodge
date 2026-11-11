/*
The Cloudflare deployment: a Worker in front of one Durable Object that holds the library in its SQLite storage
and the devices' live WebSockets. A self hosted deployment serves one library, so the object is always named
"default". The Worker answers health checks and refuses a wrong token itself, so those requests never wake the
object. Live sockets use the hibernation API: an idle object with open sockets is not billed for duration, and
keepalive pings are answered without waking it.
*/
import {DurableObject} from 'cloudflare:workers';
import {CORS_HEADERS, createApi, DEFAULT_LIMITS, MIN_TOKEN_LENGTH} from './api';
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
	sameToken,
} from './live';
import {SqlChangeLog} from './sql-change-log';

type Env = {
	LIBRARY: DurableObjectNamespace<SyncLibrary>;
	TABLODGE_SYNC_TOKEN?: string;
	MAX_RECORDS?: string;
	RETENTION_DAYS?: string;
	RATE_LIMIT_PER_MINUTE?: string;
};

const positive = (raw: string | undefined, fallback: number) => {
	const value = Number(raw);
	return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

type Attachment = {authenticated: boolean; openedAt: number};

export class SyncLibrary extends DurableObject<Env> {
	private readonly log: SqlChangeLog;
	private readonly api: ReturnType<typeof createApi>;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const {storage} = ctx;
		this.log = new SqlChangeLog({
			all: (query, ...parameters) =>
				storage.sql.exec(query, ...parameters).toArray() as Array<
					Record<string, string | number | null>
				>,
			transaction: (work) => storage.transactionSync(work),
		});
		this.api = createApi({
			token: env.TABLODGE_SYNC_TOKEN ?? '',
			log: () => this.log,
			limits: {
				maxRecords: positive(env.MAX_RECORDS, DEFAULT_LIMITS.maxRecords),
				retentionDays: positive(
					env.RETENTION_DAYS,
					DEFAULT_LIMITS.retentionDays,
				),
				requestsPerMinute: positive(
					env.RATE_LIMIT_PER_MINUTE,
					DEFAULT_LIMITS.requestsPerMinute,
				),
			},
			onApplied(cursor) {
				for (const socket of ctx.getWebSockets()) {
					if (
						(socket.deserializeAttachment() as Attachment | null)?.authenticated
					) {
						socket.send(cursorMessage(cursor));
					}
				}
			},
		});
		ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG),
		);
	}

	override async fetch(request: Request): Promise<Response> {
		if (new URL(request.url).pathname !== LIVE_PATH) {
			return this.api.fetch(request);
		}

		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
			return new Response('Expected a WebSocket upgrade', {status: 426});
		}

		if (this.ctx.getWebSockets().length >= LIVE_MAX_SOCKETS) {
			return new Response('Too many connections', {status: 503});
		}

		const pair = new WebSocketPair();
		this.ctx.acceptWebSocket(pair[1]);
		pair[1].serializeAttachment({
			authenticated: false,
			openedAt: Date.now(),
		} satisfies Attachment);
		// An alarm closes it if no token arrives in time; it fires only while such sockets exist.
		if ((await this.ctx.storage.getAlarm()) === null) {
			await this.ctx.storage.setAlarm(Date.now() + LIVE_AUTH_TIMEOUT_MS);
		}

		return new Response(null, {status: 101, webSocket: pair[0]});
	}

	override async alarm() {
		const now = Date.now();
		let waiting = false;
		for (const socket of this.ctx.getWebSockets()) {
			const attachment = socket.deserializeAttachment() as Attachment | null;
			if (attachment?.authenticated) {
				continue;
			}

			if (now - (attachment?.openedAt ?? 0) >= LIVE_AUTH_TIMEOUT_MS) {
				socket.close(LIVE_UNAUTHORIZED, 'unauthorized');
			} else {
				waiting = true;
			}
		}

		if (waiting) {
			await this.ctx.storage.setAlarm(now + LIVE_AUTH_TIMEOUT_MS);
		}
	}

	override async webSocketMessage(
		socket: WebSocket,
		message: string | ArrayBuffer,
	) {
		if ((socket.deserializeAttachment() as Attachment | null)?.authenticated) {
			return;
		}

		if (isAuthMessage(message, this.env.TABLODGE_SYNC_TOKEN ?? '')) {
			socket.serializeAttachment({
				authenticated: true,
				openedAt: 0,
			} satisfies Attachment);
			socket.send(readyMessage(this.log.cursor));
		} else {
			socket.close(LIVE_UNAUTHORIZED, 'unauthorized');
		}
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const {pathname} = new URL(request.url);
		// Answered here like the token check below, so neither wakes the Durable Object.
		if (request.method === 'OPTIONS') {
			return new Response(null, {status: 204, headers: CORS_HEADERS});
		}

		if (pathname === '/health') {
			return Response.json({ok: true}, {headers: CORS_HEADERS});
		}

		const token = env.TABLODGE_SYNC_TOKEN ?? '';
		if (token.length < MIN_TOKEN_LENGTH) {
			return Response.json(
				{error: 'not_configured'},
				{status: 503, headers: CORS_HEADERS},
			);
		}

		if (pathname !== LIVE_PATH) {
			const given =
				/^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1] ??
				'';
			if (!sameToken(given, token)) {
				return Response.json(
					{error: 'unauthorized'},
					{status: 401, headers: CORS_HEADERS},
				);
			}
		}

		return env.LIBRARY.get(env.LIBRARY.idFromName('default')).fetch(request);
	},
} satisfies ExportedHandler<Env>;
