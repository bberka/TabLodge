import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {ICON_IDS} from '../src/shared/icon-ids';
import {ICON_INFOS, searchIconInfos} from '../src/shared/icon-meta';

describe('icon search data', () => {
	test('every icon has a name and the search finds it by topic or a typo', () => {
		assert.equal(ICON_INFOS.length, ICON_IDS.length);
		assert.equal(searchIconInfos('').length, ICON_IDS.length);
		assert.equal(searchIconInfos('bokmark')[0]?.id, 'bookmark');
		assert.ok(searchIconInfos('travel').length > 1);
		assert.equal(searchIconInfos('zzzzqqq').length, 0);
	});
});
