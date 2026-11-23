import type {Store} from '../../../extension/src/shared/types';
import {writeJson} from '../platform/storage';
import {emptyStore} from './store-shape';

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
			notify();
			await writeJson(libraryKey, next);
		},
	};
}
