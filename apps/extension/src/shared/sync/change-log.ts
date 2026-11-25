import {MAX_CLOCK_DRIFT_MS, parseStamp, type Stamp, stampAt} from './clock';
import {recordKey, supersedes, type SyncChange} from './changes';

export const PROTOCOL_VERSION = 1;

export type PushResult = 'applied' | 'superseded' | 'stale' | 'clock';

export type PullResponse =
	| {
			resync: false;
			changes: SyncChange[];
			cursor: number;
			more: boolean;
			purged: number;
	  }
	| {resync: true};

export const mustResync = (cursor: number, seen: number, purgedSeq: number) =>
	cursor > 0 && cursor < purgedSeq && seen < purgedSeq;

export type SyncLog = {
	readonly cursor: number;
	readonly size: number;
	push(changes: readonly SyncChange[], now: number): PushResult[];
	pull(cursor: number, limit: number, seen?: number): PullResponse;
	purge(before: number): void;
	readonly key: string | null;
	replaceKey(next: string, expected: string | null): boolean;
};

export function pushResult(
	change: SyncChange,
	current: Stamp | undefined,
	purgedH: string,
	now: number,
): PushResult {
	if (parseStamp(change.h)!.wall > now + MAX_CLOCK_DRIFT_MS) {
		return 'clock';
	}

	if (!current && change.h <= purgedH) {
		return 'stale';
	}

	return supersedes(change, current) ? 'applied' : 'superseded';
}

type Entry = {change: SyncChange; seq: number};

export class ChangeLog implements SyncLog {
	private readonly entries = new Map<string, Entry>();
	private seq = 0;
	private purgedSeq = 0;
	private purgedH = '';
	private storedKey: string | null = null;

	get key() {
		return this.storedKey;
	}

	replaceKey(next: string, expected: string | null) {
		if (this.storedKey !== expected) {
			return false;
		}

		this.storedKey = next;
		return true;
	}

	get cursor() {
		return this.seq;
	}

	get size() {
		return this.entries.size;
	}

	push(changes: readonly SyncChange[], now: number): PushResult[] {
		return changes.map((change) => {
			const key = recordKey(change);
			const result = pushResult(
				change,
				this.entries.get(key)?.change,
				this.purgedH,
				now,
			);
			if (result === 'applied') {
				this.seq += 1;
				this.entries.set(key, {change, seq: this.seq});
			}

			return result;
		});
	}

	pull(cursor: number, limit: number, seen = 0): PullResponse {
		if (mustResync(cursor, seen, this.purgedSeq)) {
			return {resync: true};
		}

		const after = [...this.entries.values()]
			.filter((entry) => entry.seq > cursor)
			.toSorted((a, b) => a.seq - b.seq);
		const page = after.slice(0, limit);
		return {
			resync: false,
			changes: page.map((entry) => entry.change),
			cursor: page.at(-1)?.seq ?? this.seq,
			more: after.length > limit,
			purged: this.purgedSeq,
		};
	}

	purge(before: number) {
		const horizon = stampAt(before);
		for (const [key, {change, seq}] of this.entries) {
			if (!(change.deleted && change.h < horizon)) {
				continue;
			}

			this.entries.delete(key);
			this.purgedSeq = Math.max(this.purgedSeq, seq);
			if (change.h > this.purgedH) {
				this.purgedH = change.h;
			}
		}
	}
}
