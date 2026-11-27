export const DEVICE_KEY = 'tablodge.device';
export const MAX_DEVICE_NAME = 60;

export type DeviceKind = 'desktop' | 'mobile';

export type DeviceStamp = {deviceName?: string; deviceKind?: DeviceKind};

export function cleanDeviceName(value: unknown): string {
	return typeof value === 'string'
		? value.replaceAll(/\s+/g, ' ').trim().slice(0, MAX_DEVICE_NAME)
		: '';
}

export const isDeviceKind = (value: unknown): value is DeviceKind =>
	value === 'desktop' || value === 'mobile';

export function deviceStamp(name: string, kind: DeviceKind): DeviceStamp {
	const clean = cleanDeviceName(name);
	return clean ? {deviceName: clean, deviceKind: kind} : {};
}

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

export function defaultBrowserDeviceName(
	userAgent: string,
	os: string,
	brands: readonly string[] = [],
): string {
	return `${browserName(userAgent, brands)} on ${SYSTEMS[os] ?? 'this computer'}`;
}

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
