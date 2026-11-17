/*
Every way to get TabLodge, in one place. A new platform (an iPhone app, say) is one more entry here, a path in
ButtonIcon, and a case in platform.ts. The buttons, the menu, and the footer all read this list.
*/
import {SITE} from '../site';
import type {Store} from './platform';

export type Download = {
	id: Store;
	/**
	The button text.
	*/
	label: string;
	/**
	Words before the label on the first button of a wide screen, for example "Install from".
	*/
	lead?: string;
	/**
	The footer link text.
	*/
	footer: string;
	href: string;
};

export const DOWNLOADS: Download[] = [
	{id: 'chrome', label: 'Chrome Web Store', lead: 'Install from ', footer: 'Chrome Web Store', href: SITE.chromeWebStore},
	{id: 'firefox', label: 'Get for Firefox', footer: 'Firefox Add-ons', href: SITE.firefoxAddons},
	{id: 'android', label: 'Get for Android', footer: 'Android APK', href: SITE.androidApk},
];

export const download = (id: Store): Download => DOWNLOADS.find((item) => item.id === id)!;
