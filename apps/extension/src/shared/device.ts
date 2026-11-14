/*
Which device saved a session. The name is the person's own ("Berkay's MacBook") and belongs to one device, not to a
platform: it is kept on the device, defaults to something read from the system, and is stamped onto each session it
saves. Renaming a device does not rewrite sessions already saved, which keep the name they were saved under.
*/

/**
Where the device name is kept on the device. It never syncs: each device has its own.
*/
export const DEVICE_KEY = 'tablodge.device';
export const MAX_DEVICE_NAME = 60;

export type DeviceKind = 'desktop' | 'mobile';

export type DeviceStamp = {deviceName?: string; deviceKind?: DeviceKind};

/**
A name as typed: one line, trimmed, no longer than a label can hold. Empty when there is nothing usable.
*/
export function cleanDeviceName(value: unknown): string {
	return typeof value === 'string'
		? value.replaceAll(/\s+/g, ' ').trim().slice(0, MAX_DEVICE_NAME)
		: '';
}

export const isDeviceKind = (value: unknown): value is DeviceKind =>
	value === 'desktop' || value === 'mobile';

/**
The fields that say where a session was saved, or nothing when the device has no name.
*/
export function deviceStamp(name: string, kind: DeviceKind): DeviceStamp {
	const clean = cleanDeviceName(name);
	return clean ? {deviceName: clean, deviceKind: kind} : {};
}

/**
Browsers that send a stock Chrome or Firefox user agent but name themselves elsewhere: in the user agent brand list
(Chromium browsers), or by a token in the user agent string. The first match wins, so the specific names come first.
*/
const BRANDS: Array<[RegExp, string]> = [
	[/^brave$/i, 'Brave'],
	[/^vivaldi$/i, 'Vivaldi'],
	[/^microsoft edge$/i, 'Edge'],
	[/^opera/i, 'Opera'],
	[/^yandex/i, 'Yandex'],
	[/^samsung/i, 'Samsung Internet'],
	[/^arc$/i, 'Arc'],
	[/^duckduckgo/i, 'DuckDuckGo'],
	[/^google chrome$/i, 'Chrome'],
];

const TOKENS: Array<[RegExp, string]> = [
	[/\bEdg(?:e|A|iOS)?\//, 'Edge'],
	[/\b(?:OPR|OPT)\//, 'Opera'],
	[/\bVivaldi\//, 'Vivaldi'],
	[/\bYaBrowser\//, 'Yandex'],
	[/\bSamsungBrowser\//, 'Samsung Internet'],
	[/\bDdg\//, 'DuckDuckGo'],
	[/\bWaterfox\//, 'Waterfox'],
	[/\bFloorp\//, 'Floorp'],
	[/\bLibreWolf\//, 'LibreWolf'],
	[/\bPaleMoon\//, 'Pale Moon'],
	[/\bSeaMonkey\//, 'SeaMonkey'],
	[/\bFirefox\//, 'Firefox'],
	[/Chrome\//, 'Chrome'],
];

/**
The browser's own name, for "Chrome on Linux". The brand list (from the browser's user agent data) is read first,
because Brave and others send Chrome's user agent string. Then the user agent tokens. Forks that copy Firefox's user
agent exactly (such as Zen) cannot be told apart and show as Firefox.
*/
export function browserName(
	userAgent = '',
	brands: readonly string[] = [],
): string {
	for (const [pattern, name] of BRANDS) {
		if (brands.some((brand) => pattern.test(brand.trim()))) {
			return name;
		}
	}

	for (const [pattern, name] of TOKENS) {
		if (pattern.test(userAgent)) {
			return name;
		}
	}

	return 'Browser';
}

const SYSTEMS: Record<string, string> = {
	mac: 'macOS',
	win: 'Windows',
	linux: 'Linux',
	cros: 'ChromeOS',
	android: 'Android',
	openbsd: 'OpenBSD',
	fuchsia: 'Fuchsia',
};

/**
The name a desktop browser gets until its owner picks one: the browser and the system it runs on.
*/
export function defaultBrowserDeviceName(
	userAgent: string,
	os: string,
	brands: readonly string[] = [],
): string {
	return `${browserName(userAgent, brands)} on ${SYSTEMS[os] ?? 'this computer'}`;
}

/**
The name a phone gets until its owner picks one: the maker and model, without the maker said twice.
*/
export function defaultPhoneDeviceName(brand: string, model: string): string {
	const maker = brand.trim();
	const name = model.trim();
	if (!name) {
		return maker || 'Phone';
	}

	return !maker || name.toLowerCase().startsWith(maker.toLowerCase())
		? name
		: `${maker[0].toUpperCase()}${maker.slice(1)} ${name}`;
}
