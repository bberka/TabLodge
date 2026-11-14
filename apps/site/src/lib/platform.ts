/*
Works out which TabLodge download suits the visitor's device, so the landing page can put it first. Pure, so every
case is tested without a browser. The page runs it in the visitor's browser, and without scripts it simply shows all
the options in a fixed order.
*/
export type Store = 'chrome' | 'firefox' | 'android';

export type PlatformId =
	| 'chromium'
	| 'firefox'
	| 'android'
	| 'ios'
	| 'safari'
	| 'other';

export type Platform = {
	id: PlatformId;
	/**
	The download to highlight, or none when this device has no matching one.
	*/
	primary: Store | undefined;
	/**
	All downloads, best first.
	*/
	order: Store[];
	/**
	A line to show under the buttons when the match is partial or missing.
	*/
	note: string | undefined;
};

/**
What a browser's `navigator` offers that the user agent text does not: `userAgentData` (mobile and platform) where it
exists, and the touch point count that tells an iPad, which reports itself as a Mac, from a Mac.
*/
export type Hints = {
	mobile?: boolean;
	platform?: string;
	touchPoints?: number;
};

// Chrome 116 is the oldest the extension supports; Firefox 140 is the first with the tab group support it needs.
export const MIN_CHROMIUM = 116;
export const MIN_FIREFOX = 140;

const DEFAULT_ORDER: Store[] = ['chrome', 'firefox', 'android'];

const NOTES = {
	android:
		'This is the Android app. The browser extensions are for a computer: open this page there to install them.',
	ios: 'There is no iPhone or iPad app yet, and Safari cannot run the extension. Open this page on a computer to install TabLodge in Chrome or Firefox, or on an Android phone for the app.',
	safari:
		'Safari cannot run the extension. Use Chrome or another Chromium browser, or Firefox, on this computer.',
	other:
		'We could not tell which browser or device you use. Pick the one that matches it.',
	oldChromium: `TabLodge needs Chrome ${MIN_CHROMIUM} or newer, or a Chromium browser of the same age. Update your browser first.`,
	oldFirefox: `TabLodge needs Firefox ${MIN_FIREFOX} or newer. Update Firefox first.`,
} as const;

const first = (order: Store[], store: Store): Store[] => [
	store,
	...order.filter((other) => other !== store),
];

const version = (ua: string, pattern: RegExp): number | undefined => {
	const found = pattern.exec(ua)?.[1];
	return found === undefined ? undefined : Number.parseInt(found, 10);
};

/**
The best download for this device. Pass the user agent string and, when the browser has them, the hints.
*/
export function detectPlatform(ua: string, hints: Hints = {}): Platform {
	const agent = ua || '';
	// An iPad asks for the desktop site, so its user agent names a Mac. It is a Mac with a touch screen.
	const iPadAsMac =
		/Macintosh/.test(agent) && (hints.touchPoints ?? 0) > 1;
	if (/iPhone|iPad|iPod/.test(agent) || iPadAsMac) {
		return {id: 'ios', primary: undefined, order: DEFAULT_ORDER, note: NOTES.ios};
	}

	if (/Android/.test(agent) || (hints.mobile === true && hints.platform === 'Android')) {
		return {
			id: 'android',
			primary: 'android',
			order: first(DEFAULT_ORDER, 'android'),
			note: NOTES.android,
		};
	}

	// Any other phone or tablet cannot run an extension and has no app to install.
	if (hints.mobile === true) {
		return {id: 'other', primary: undefined, order: DEFAULT_ORDER, note: NOTES.other};
	}

	const firefox = version(agent, /Firefox\/(\d+)/);
	if (firefox !== undefined && !/Seamonkey/i.test(agent)) {
		return {
			id: 'firefox',
			primary: 'firefox',
			order: first(DEFAULT_ORDER, 'firefox'),
			note: firefox < MIN_FIREFOX ? NOTES.oldFirefox : undefined,
		};
	}

	// Every Chromium browser, reduced user agent or not, still says Chrome/<major> in its user agent string.
	const chromium = version(agent, /(?:Chrome|Chromium|Edg|OPR)\/(\d+)/);
	if (chromium !== undefined) {
		return {
			id: 'chromium',
			primary: 'chrome',
			order: DEFAULT_ORDER,
			note: chromium < MIN_CHROMIUM ? NOTES.oldChromium : undefined,
		};
	}

	if (/Safari\//.test(agent) && /Macintosh|Mac OS X/.test(agent)) {
		return {id: 'safari', primary: undefined, order: DEFAULT_ORDER, note: NOTES.safari};
	}

	return {id: 'other', primary: undefined, order: DEFAULT_ORDER, note: NOTES.other};
}

/**
Reads the hints this browser offers. Only for the page; the tests pass their own.
*/
export function readHints(nav: Navigator): Hints {
	const data = (nav as Navigator & {
		userAgentData?: {mobile?: boolean; platform?: string};
	}).userAgentData;
	return {
		mobile: data?.mobile,
		platform: data?.platform,
		touchPoints: nav.maxTouchPoints,
	};
}
