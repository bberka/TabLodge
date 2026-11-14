import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {detectPlatform} from '../site/src/lib/platform';

const UA = {
	chromeWin:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	chromeOld:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
	edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
	opera:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
	chromeOs:
		'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	firefoxLinux:
		'Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0',
	firefoxOld:
		'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
	safariMac:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
	iphoneSafari:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
	iphoneChrome:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1',
	androidChrome:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
	androidFirefox:
		'Mozilla/5.0 (Android 14; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0',
	androidTablet:
		'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	samsung:
		'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
	googlebot:
		'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
} as const;

describe('detectPlatform', () => {
	test('a Chromium desktop browser gets the Chrome Web Store first', () => {
		for (const ua of [UA.chromeWin, UA.edge, UA.opera, UA.chromeOs]) {
			const result = detectPlatform(ua);
			assert.equal(result.id, 'chromium');
			assert.equal(result.primary, 'chrome');
			assert.deepEqual(result.order, ['chrome', 'firefox', 'android']);
			assert.equal(result.note, undefined);
		}
	});

	test('an old Chromium browser still gets Chrome, with a note to update', () => {
		const result = detectPlatform(UA.chromeOld);
		assert.equal(result.primary, 'chrome');
		assert.match(result.note ?? '', /116/);
	});

	test('Firefox on a computer gets Firefox first, and a note when it is too old', () => {
		const result = detectPlatform(UA.firefoxLinux);
		assert.equal(result.id, 'firefox');
		assert.deepEqual(result.order, ['firefox', 'chrome', 'android']);
		assert.equal(result.note, undefined);
		assert.match(detectPlatform(UA.firefoxOld).note ?? '', /140/);
	});

	test('an Android phone or tablet gets the Android app first, in any browser', () => {
		for (const ua of [
			UA.androidChrome,
			UA.androidFirefox,
			UA.androidTablet,
			UA.samsung,
		]) {
			const result = detectPlatform(ua);
			assert.equal(result.id, 'android');
			assert.equal(result.primary, 'android');
			assert.equal(result.order[0], 'android');
			assert.match(result.note ?? '', /computer/);
		}
	});

	test('Android is found from the hints when the user agent is reduced', () => {
		const result = detectPlatform(
			'Mozilla/5.0 (Linux; K) Chrome/131.0.0.0 Mobile',
			{
				mobile: true,
				platform: 'Android',
			},
		);
		assert.equal(result.primary, 'android');
	});

	test('an iPhone or an iPad has nothing to install and is told so, in any browser', () => {
		for (const ua of [UA.iphoneSafari, UA.iphoneChrome]) {
			const result = detectPlatform(ua);
			assert.equal(result.id, 'ios');
			assert.equal(result.primary, undefined);
			assert.match(result.note ?? '', /no iPhone or iPad app/);
		}

		// An iPad that asks for the desktop site reports a Mac, but has a touch screen.
		const ipad = detectPlatform(UA.safariMac, {touchPoints: 5});
		assert.equal(ipad.id, 'ios');
	});

	test('Safari on a Mac is unsupported, and says which browsers work', () => {
		const result = detectPlatform(UA.safariMac, {touchPoints: 0});
		assert.equal(result.id, 'safari');
		assert.equal(result.primary, undefined);
		assert.match(result.note ?? '', /Chrome.*Firefox/);
	});

	test('anything unrecognized shows every option and says it could not tell', () => {
		for (const ua of [UA.googlebot, '']) {
			const result = detectPlatform(ua);
			assert.equal(result.id, 'other');
			assert.equal(result.primary, undefined);
			assert.deepEqual(result.order, ['chrome', 'firefox', 'android']);
			assert.match(result.note ?? '', /could not tell/);
		}
	});

	test('a mobile device that is not Android gets no extension to install', () => {
		const result = detectPlatform('Mozilla/5.0 (Mobile; rv:1.0) Gecko', {
			mobile: true,
			platform: 'KaiOS',
		});
		assert.equal(result.primary, undefined);
	});
});
