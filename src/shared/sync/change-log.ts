/*
The server side of the protocol for one library, kept in memory. It is the reference the Durable Object and the
Docker server implement over their own storage, and the fake server the client tests sync against.

Every accepted change gets the next sequence number. A device pulls the changes after the last number it saw
(its cursor), and only the newest change per record is kept, so a pull after a long time offline returns one
change per record instead of a replay. Tombstones are kept for a retention window and then purged.

Each pull answer carries `purged`, the highest sequence number among purged tombstones, and the device sends back
the value it last saw. When a purge since then removed tombstones after the device's cursor, the device missed
deletes it can no longer be told about, so it must pull everything again from cursor 0 (`resync`). A device paging
through a fresh pull is not sent back to the start: purges older than its first page took nothing it had.
*/
import {MAX_CLOCK_DRIFT_MS, parseStamp, type Stamp, stampAt} from './clock';
import {recordKey, supersedes, type SyncChange} from './changes';

/**
- `applied`: the change is now the record's current version.
- `superseded`: the server already has a newer version, which the device gets on its next pull.
- `stale`: the change is about a record the server has no trace of and is older than the purge horizon, so the
  record may have been deleted and purged. Accepting it could bring a deleted record back.
- `clock`: the stamp is too far in the future.
*/
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

/**
True when tombstones after `cursor` were purged since the device last saw the purge marker (`seen`).
*/
export const mustResync = (cursor: number, seen: number, purgedSeq: number) =>
	cursor > 0 && cursor < purgedSeq && seen < purgedSeq;

/**
What every server storage implements, with the rules of `ChangeLog`.
*/
export type SyncLog = {
	readonly cursor: number;
	/**
	Stored records, tombstones included.
	*/
	readonly size: number;
	push(changes: readonly SyncChange[], now: number): PushResult[];
	/**
	`seen` is the `purged` value of the device's previous pull.
	*/
	pull(cursor: number, limit: number, seen?: number): PullResponse;
	/**
	Drops tombstones written before `before` (a wall time in milliseconds).
	*/
	purge(before: number): void;
};

/**
The outcome of pushing `change` when the server holds `current` for its record.
*/
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
	/**
	Highest sequence number among purged tombstones. A cursor below it has missed a delete.
	*/
	private purgedSeq = 0;
	/**
	Newest stamp among purged tombstones.
	*/
	private purgedH = '';

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
			// The server's own cursor, even when it is behind the device's: that is how a device notices a server
			// restored from an older backup.
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
