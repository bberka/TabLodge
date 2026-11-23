import type {Store} from '../../../extension/src/shared/types';
import {
	createDevFixture,
	type DevStore,
} from '../../../extension/src/shared/dev-fixture';
import {emptyStore} from './store-shape';

export function sampleStore(now: number): Store {
	const base = emptyStore(now);
	return createDevFixture({
		...base,
		settings: {},
	} as DevStore) as unknown as Store;
}
