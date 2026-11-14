import type {Store} from '../../extension/src/app/types';
import {emptyStore} from './library';
import {writeJson} from './storage';

/**
One library held in memory and saved to SQLite: reads and writes run one after another, the way the extension's
service worker does, and screens subscribe to changes. The regular and the private library each have one.
*/
export function createLibraryCore(libraryKey: string) {
	let store = emptyStore(Date.now());
	let queue: Promise<unknown> = Promise.resolve();
	const listeners = new Set<() => void>();

	const notify = () => {
		for (const listener of listeners) {
			listener();
		}
	};

	return {
		get store(): Store {
			return store;
		},
		/**
		Takes a library that was just read from storage.
		*/
		load(saved: Store) {
			store = saved;
			notify();
		},
		notify,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		async mutate<T>(work: () => Promise<T>): Promise<T> {
			const run = queue.then(work, work);
			queue = run.catch(() => undefined);
			return run;
		},
		async write(next: Store): Promise<void> {
			store = next;
			await writeJson(libraryKey, next);
			notify();
		},
	};
}
