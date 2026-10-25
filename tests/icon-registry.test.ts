import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {ICON_IDS} from '../src/app/icon-ids';
import {
	DEFAULT_COLUMN_ICON,
	DEFAULT_FOLDER_ICON,
	ICONS,
	getIcon,
	isIconId,
	searchIcons,
} from '../src/app/icon-registry';

test('the registry has one unique, kebab-case entry per icon id', () => {
	assert.equal(ICONS.length, ICON_IDS.length);
	assert.equal(new Set(ICON_IDS).size, ICON_IDS.length);
	for (const icon of ICONS) {
		assert.match(icon.id, /^[a-z]+(-[a-z]+)*$/);
		assert.ok(icon.component);
		assert.ok(icon.keywords.length > 0);
	}

	assert.ok(ICONS.length >= 100);
});

test('default icons exist and getIcon falls back for unknown ids', () => {
	assert.equal(DEFAULT_COLUMN_ICON, 'bookmark');
	assert.equal(DEFAULT_FOLDER_ICON, 'folder');
	assert.equal(getIcon('star').id, 'star');
	assert.equal(getIcon('no-such-icon').id, 'bookmark');
	assert.equal(getIcon(undefined, 'folder').id, 'folder');
	assert.equal(isIconId('folder'), true);
	assert.equal(isIconId('nope'), false);
	assert.equal(isIconId(7), false);
});

test('searchIcons matches names, keywords and subsequences, best first', () => {
	assert.equal(searchIcons('').length, ICONS.length);
	assert.equal(searchIcons('git')[0].id.startsWith('git'), true);
	assert.ok(searchIcons('podcast').some((icon) => icon.id === 'headphones'));
	assert.ok(searchIcons('GITBR').some((icon) => icon.id === 'git-branch'));
	assert.equal(searchIcons('zzzzqqq').length, 0);
	assert.equal(searchIcons('star')[0].id, 'star');
});
