import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {contextMenuPlan, hasTabMenu} from '../src/shared/context-menu-plan';
import {DEFAULT_SETTINGS} from '../src/shared/library-normalize';

const env = {
	appName: 'TabLodge',
	hasSidePanel: true,
	hasTabContext: false,
	hasAmpersandAccessKeys: false,
};
const columns = [{id: 'c1', name: 'Read', createdAt: 0, isDefault: false}];
const on = {
	...DEFAULT_SETTINGS,
	contextMenusEnabled: true,
	contextMenuLinksEnabled: true,
	contextMenuPageEnabled: true,
	contextMenuSelectionEnabled: true,
	contextMenuActionEnabled: true,
};

const chromeUserAgent = (major: number) =>
	`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;

describe('hasTabMenu', () => {
	test('Chromium 150 or newer has the tab strip menu when it lists the context', () => {
		for (const major of [150, 158]) {
			assert.equal(
				hasTabMenu({
					listsTabContext: true,
					isFirefox: false,
					userAgent: chromeUserAgent(major),
				}),
				true,
				`Chrome ${major}`,
			);
		}

		const edge = `${chromeUserAgent(150)} Edg/150.0.0.0`;
		assert.equal(
			hasTabMenu({listsTabContext: true, isFirefox: false, userAgent: edge}),
			true,
		);
	});

	test('older Chromium has none, even when it lists the context', () => {
		for (const [userAgent, listsTabContext] of [
			[chromeUserAgent(149), true],
			[chromeUserAgent(116), false],
			['', true],
		] as const) {
			assert.equal(
				hasTabMenu({listsTabContext, isFirefox: false, userAgent}),
				false,
				userAgent,
			);
		}
	});

	test('Firefox follows the API alone', () => {
		const userAgent =
			'Mozilla/5.0 (X11; Linux x86_64; rv:160.0) Gecko/20100101 Firefox/160.0';
		assert.equal(
			hasTabMenu({listsTabContext: true, isFirefox: true, userAgent}),
			true,
		);
		assert.equal(
			hasTabMenu({listsTabContext: false, isFirefox: true, userAgent}),
			false,
		);
	});
});

describe('contextMenuPlan', () => {
	test('a quote needs a web page, and the link switch also covers images and media', () => {
		const roots = (plan: ReturnType<typeof contextMenuPlan>) =>
			plan
				.filter((item) => !item.parentId)
				.flatMap((item) => item.contexts ?? []);
		const plan = contextMenuPlan(on, columns, [], env);
		const quote = plan.find((item) => item.id === 'tablodge-selection-quote');
		assert.deepEqual(quote?.contexts, ['selection']);
		assert.deepEqual(quote?.documentUrlPatterns, ['http://*/*', 'https://*/*']);

		const linksOff = roots(
			contextMenuPlan(
				{...on, contextMenuLinksEnabled: false},
				columns,
				[],
				env,
			),
		);
		for (const context of ['link', 'image', 'video', 'audio'] as const) {
			assert.ok(
				!linksOff.includes(context),
				`${context} goes with the Links switch`,
			);
		}
	});

	test('Save image to sits under Bookmark image to, and a private window has none', () => {
		const imageMenu = (keepsImages: boolean) =>
			contextMenuPlan(on, columns, [], {...env, keepsImages})
				.filter((item) => item.parentId === 'tablodge-image-root')
				.map((item) => item.title);
		assert.deepEqual(imageMenu(true), ['Bookmark image to', 'Save image to']);
		assert.deepEqual(imageMenu(false), ['Bookmark image to']);

		const save = contextMenuPlan(on, columns, [], {
			...env,
			keepsImages: true,
		}).filter((item) => item.id?.startsWith('tablodge-image-save'));
		for (const item of save) {
			assert.deepEqual(item.contexts, ['image']);
			assert.deepEqual(
				item.targetUrlPatterns,
				['http://*/*', 'https://*/*'],
				'never offered for a data: or blob: image',
			);
		}
	});

	test('Firefox shows an ampersand in every title, built in or named by the user', () => {
		const names = [{id: 'rd', name: 'R&D', createdAt: 0, isDefault: false}];
		const sessions = [{id: 's1', name: 'Q&A'}];
		const titles = (hasAmpersandAccessKeys: boolean) =>
			new Map(
				contextMenuPlan(on, names, sessions, {
					...env,
					appName: 'Tab&Lodge',
					hasAmpersandAccessKeys,
				}).map((item) => [item.id, item.title]),
			);

		const chromium = titles(false);
		assert.equal(
			chromium.get('tablodge-selection-search'),
			'Search saved tabs & bookmarks for “%s”',
		);
		assert.equal(chromium.get('tablodge-page-bookmark:rd'), 'R&D');
		assert.equal(chromium.get('tablodge-selection-quote'), 'Save quote');

		const firefox = titles(true);
		assert.equal(
			firefox.get('tablodge-selection-search'),
			'Search saved tabs && bookmarks for “%s”',
		);
		assert.equal(firefox.get('tablodge-selection-quote'), 'Save quote');
		assert.equal(firefox.get('tablodge-selection-root'), 'Tab&&Lodge');
		for (const id of [
			'tablodge-link-bookmark:rd',
			'tablodge-image-bookmark:rd',
			'tablodge-media-bookmark:rd',
			'tablodge-page-bookmark:rd',
		]) {
			assert.equal(firefox.get(id), 'R&&D', id);
		}

		assert.equal(firefox.get('tablodge-page-send:s1'), 'Q&&A');
		assert.equal(firefox.get('tablodge-page-root'), 'Tab&&Lodge');
	});
});
