import {type KeyValueBackend} from '../src/shared/library-state';
import {sortKeysDeep} from './library-fixtures';

export type Raw = Record<string, unknown>;

export class MemoryBackend implements KeyValueBackend {
	data = new Map<string, unknown>();
	calls = 0;
	bytesWritten = 0;
	failAt: number | undefined;
	tear = false;
	sets: Array<{keys: string[]}> = [];
	corruptKey: ((key: string) => boolean) | undefined;
	rejectKey: ((key: string) => boolean) | undefined;
	onGet: ((keys: string[]) => Promise<void>) | undefined;

	constructor(initial: Raw = {}) {
		for (const [key, value] of Object.entries(initial)) {
			this.data.set(key, structuredClone(value));
		}
	}

	private crashNow() {
		this.calls += 1;
		return this.failAt !== undefined && this.calls === this.failAt;
	}

	snapshot() {
		return structuredClone([...this.data]);
	}

	async get(keys: string[]) {
		if (this.crashNow()) {
			throw new Error('crash');
		}

		await this.onGet?.(keys);
		return Object.fromEntries(
			keys
				.filter((key) => this.data.has(key))
				.map((key) => [key, sortKeysDeep(this.data.get(key))]),
		);
	}

	async set(values: Raw) {
		const entries = Object.entries(values);
		if (this.rejectKey && entries.some(([key]) => this.rejectKey!(key))) {
			throw new Error('QUOTA_BYTES quota exceeded');
		}

		if (this.crashNow()) {
			if (this.tear) {
				for (const [key, value] of entries.slice(
					0,
					Math.ceil(entries.length / 2),
				)) {
					this.data.set(key, structuredClone(value));
				}
			}

			throw new Error('crash');
		}

		this.sets.push({
			keys: entries.map(([key]) => key),
		});
		this.bytesWritten += JSON.stringify(values).length;
		for (const [key, value] of entries) {
			this.data.set(
				key,
				this.corruptKey?.(key)
					? {...(value as Raw), tabs: []}
					: structuredClone(value),
			);
		}
	}

	async remove(keys: string[]) {
		if (this.crashNow()) {
			if (this.tear) {
				for (const key of keys.slice(0, Math.ceil(keys.length / 2))) {
					this.data.delete(key);
				}
			}

			throw new Error('crash');
		}

		for (const key of keys) {
			this.data.delete(key);
		}
	}

	async getBytesInUse(keys: string[]) {
		return keys.reduce(
			(total, key) =>
				total +
				(this.data.has(key) ? JSON.stringify(this.data.get(key)).length : 0),
			0,
		);
	}
}

export const session = (id: string, tabs: number, extra: Raw = {}): Raw => ({
	id,
	name: `Session ${id}`,
	folderId: 'unfiled',
	createdAt: 1000,
	updatedAt: 2000,
	tabs: Array.from({length: tabs}, (_, index) => ({
		id: `${id}-t${index}`,
		url: `https://example.com/${id}/${index}`,
		title: `Tab ${index} of ${id}`,
	})),
	...extra,
});

export const library = (sessions = 7, bookmarks = 6): Raw => ({
	schemaVersion: 9,
	groups: Array.from({length: sessions}, (_, index) =>
		session(`s${index}`, 3 + index),
	),
	folders: [{id: 'unfiled', name: 'Unfiled'}],
	bookmarkColumns: [{id: 'c1', name: 'Reading'}],
	bookmarks: Array.from({length: bookmarks}, (_, index) => ({
		id: `b${index}`,
		columnId: 'c1',
		url: `https://example.com/b${index}`,
		title: `Bookmark ${index}`,
	})),
	settings: {theme: 'dark'},
	updatedAt: 5000,
});

export const normalize = (raw: Raw): Raw => ({
	...raw,
	schemaVersion: 10,
	groups: (Array.isArray(raw.groups) ? raw.groups : []).filter(
		(group: unknown) =>
			typeof group === 'object' &&
			group !== null &&
			typeof (group as Raw).id === 'string',
	),
	bookmarks: Array.isArray(raw.bookmarks) ? raw.bookmarks : [],
});
