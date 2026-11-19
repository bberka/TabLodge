import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {openChoices, settingsOpener} from '../src/platform/open-choices';

const prefs = {
	openWith: 'inapp',
	openApp: '',
	privateOpenWith: 'app',
	privateOpenApp: 'org.mozilla.focus',
} as const;

describe('where a link opens when nothing was picked', () => {
	test('the regular library follows Open links', () => {
		assert.deepEqual(settingsOpener(prefs, false), {how: 'inapp', app: ''});
	});

	test('the private library follows its own choice', () => {
		assert.deepEqual(settingsOpener(prefs, true), {
			how: 'app',
			app: 'org.mozilla.focus',
		});
	});

	test('the private library follows Open links when set to the same', () => {
		assert.deepEqual(
			settingsOpener(
				{
					...prefs,
					openWith: 'app',
					openApp: 'com.brave.browser',
					privateOpenWith: 'same',
				},
				true,
			),
			{how: 'app', app: 'com.brave.browser'},
		);
	});
});

describe('Open in choices', () => {
	const browsers = [
		{
			id: 'com.android.chrome',
			name: 'Chrome',
			icon: 'data:image/png;base64,AA',
		},
		{id: 'org.mozilla.firefox', name: 'Firefox'},
	];

	test('one link gets the in-app tab, the default browser, each browser, then the chooser', () => {
		const choices = openChoices(browsers, {several: false});
		assert.deepEqual(
			choices.map((choice) => [choice.label, choice.opener]),
			[
				['In-app tab', {how: 'inapp', app: ''}],
				['Default browser', {how: 'system', app: ''}],
				['Chrome', {how: 'app', app: 'com.android.chrome'}],
				['Firefox', {how: 'app', app: 'org.mozilla.firefox'}],
				['Open with…', {how: 'chooser', app: ''}],
			],
		);
		assert.equal(choices[2].image, 'data:image/png;base64,AA');
	});

	test('several links get no chooser', () => {
		assert.ok(
			openChoices(browsers, {several: true}).every(
				(choice) => choice.opener.how !== 'chooser',
			),
		);
	});

	test('two browsers with one name keep apart', () => {
		const keys = openChoices(
			[
				{id: 'a.browser', name: 'Browser'},
				{id: 'b.browser', name: 'Browser'},
			],
			{several: false},
		).map((choice) => choice.key);
		assert.equal(new Set(keys).size, keys.length);
	});
});
