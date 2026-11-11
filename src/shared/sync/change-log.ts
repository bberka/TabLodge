/*
The server side of the protocol for one library, kept in memory. It is the reference the Durable Object and the
Docker server implement over their own storage, and the fake server the client tests sync against.

Every accepted change gets the next sequence number. A device pulls the changes after the last number it saw
(its cursor), and only the newest change per record is kept, so a pull after a long time offline returns one
change per record instead of a replay. Tombstones are kept for a retention window and then purged. A device whose
cursor is older than the newest purge has missed deletes it can no longer be told about, so it must replace its
copy with a snapshot (`resync`) instead of pulling.
*/
import {MAX_CLOCK_DRIFT_MS, parseStamp} from './clock';
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
	| {resync: false; changes: SyncChange[]; cursor: number; more: boolean}
	| {resync: true};

type Entry = {change: SyncChange; seq: number};

export class ChangeLog {
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

	push(changes: readonly SyncChange[], now: number): PushResult[] {
		return changes.map((change) => {
			if (parseStamp(change.h)!.wall > now + MAX_CLOCK_DRIFT_MS) {
				return 'clock';
			}

			const key = recordKey(change);
			const current = this.entries.get(key)?.change;
			if (!current && change.h <= this.purgedH) {
				return 'stale';
			}

			if (!supersedes(change, current)) {
				return 'superseded';
			}

			this.seq += 1;
			this.entries.set(key, {change, seq: this.seq});
			return 'applied';
		});
	}

	pull(cursor: number, limit: number): PullResponse {
		if (cursor < this.purgedSeq) {
			return {resync: true};
		}

		const after = [...this.entries.values()]
			.filter((entry) => entry.seq > cursor)
			.toSorted((a, b) => a.seq - b.seq);
		const page = after.slice(0, limit);
		return {
			resync: false,
			changes: page.map((entry) => entry.change),
			cursor: page.at(-1)?.seq ?? Math.max(cursor, this.seq),
			more: after.length > limit,
		};
	}

	/**
	Every live record and tombstone, and the cursor to pull from afterwards.
	*/
	snapshot(): {changes: SyncChange[]; cursor: number} {
		return {
			changes: [...this.entries.values()].map((entry) => entry.change),
			cursor: this.seq,
		};
	}

	/**
	Drops tombstones written before `before` (a wall time in milliseconds).
	*/
	purge(before: number) {
		for (const [key, {change, seq}] of this.entries) {
			if (!(change.deleted && parseStamp(change.h)!.wall < before)) {
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
