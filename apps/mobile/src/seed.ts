/*
Sample data for development, the same fixture the extension's `dev:chrome:seed` loads: six sessions in folders and
sixteen bookmarks in columns. Only dev builds import this file (see `library-store.ts`).
*/
import type {Store} from '../../extension/src/shared/types';
import {
	createDevFixture,
	type DevStore,
} from '../../extension/src/shared/dev-fixture';
import {emptyStore} from './library';

export function sampleStore(now: number): Store {
	const base = emptyStore(now);
	// The fixture has its own loose types; apps/mobile/tests/mobile-library.test.ts checks the result has the library's shape.
	return createDevFixture({
		...base,
		settings: {},
	} as DevStore) as unknown as Store;
}
