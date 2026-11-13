import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	browserName,
	cleanDeviceName,
	defaultBrowserDeviceName,
	defaultPhoneDeviceName,
	deviceStamp,
} from '../src/shared/device';

describe('device names', () => {
	test('a typed name is one trimmed line of bounded length', () => {
		assert.equal(
			cleanDeviceName("  Berkay's \n  MacBook  "),
			"Berkay's MacBook",
		);
		assert.equal(cleanDeviceName('x'.repeat(200)).length, 60);
		assert.equal(cleanDeviceName(' '.repeat(3)), '');
		assert.equal(cleanDeviceName(42), '');
	});

	test('the default names the browser and the system, or the phone maker and model', () => {
		const chrome =
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
		assert.equal(browserName(chrome), 'Chrome');
		assert.equal(browserName(`${chrome} Edg/130.0`), 'Edge');
		assert.equal(
			browserName('Mozilla/5.0 Gecko/20100101 Firefox/132.0'),
			'Firefox',
		);
		assert.equal(defaultBrowserDeviceName(chrome, 'mac'), 'Chrome on macOS');
		assert.equal(
			defaultBrowserDeviceName(chrome, 'plan9'),
			'Chrome on this computer',
		);
		assert.equal(defaultPhoneDeviceName('google', 'Pixel 8'), 'Google Pixel 8');
		assert.equal(
			defaultPhoneDeviceName('samsung', 'Samsung Galaxy'),
			'Samsung Galaxy',
		);
		assert.equal(defaultPhoneDeviceName('', ''), 'Phone');
	});

	test('a session is stamped only when the device has a name', () => {
		assert.deepEqual(deviceStamp(' Desk ', 'desktop'), {
			deviceName: 'Desk',
			deviceKind: 'desktop',
		});
		assert.deepEqual(deviceStamp('  ', 'mobile'), {});
	});
});
