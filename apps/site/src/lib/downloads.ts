import {SITE} from '../site';
import type {Store} from './platform';

export type Download = {
	id: Store;
	label: string;
	lead?: string;
	footer: string;
	href: string;
};

export const DOWNLOADS: Download[] = [
	{id: 'chrome', label: 'Chrome Web Store', lead: 'Install from ', footer: 'Chrome Web Store', href: SITE.chromeWebStore},
	{id: 'firefox', label: 'Get for Firefox', footer: 'Firefox Add-ons', href: SITE.firefoxAddons},
	{id: 'android', label: 'Get for Android', footer: 'Android APK', href: SITE.androidApk},
];

export const download = (id: Store): Download => DOWNLOADS.find((item) => item.id === id)!;
