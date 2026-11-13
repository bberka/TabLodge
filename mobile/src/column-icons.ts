import {useColorScheme} from 'react-native';
import {ICON_IDS, type IconId} from '../../src/app/icon-ids';
import {avatarColor} from './theme';
import type {IconName} from './ui';

/**
The extension names column icons from a Lucide set; this picks the closest Ionicons glyph for each one.
*/
const GLYPHS: Record<IconId, IconName> = {
	bookmark: 'bookmark-outline',
	folder: 'folder-outline',
	star: 'star-outline',
	heart: 'heart-outline',
	pin: 'pin-outline',
	flag: 'flag-outline',
	tag: 'pricetag-outline',
	bell: 'notifications-outline',
	clock: 'time-outline',
	calendar: 'calendar-outline',
	lightbulb: 'bulb-outline',
	zap: 'flash-outline',
	sparkles: 'sparkles-outline',
	archive: 'archive-outline',
	inbox: 'file-tray-outline',
	link: 'link-outline',
	globe: 'globe-outline',
	search: 'search-outline',
	rocket: 'rocket-outline',
	target: 'locate-outline',
	briefcase: 'briefcase-outline',
	building: 'business-outline',
	mail: 'mail-outline',
	clipboard: 'clipboard-outline',
	'check-square': 'checkbox-outline',
	presentation: 'easel-outline',
	chart: 'bar-chart-outline',
	'trending-up': 'trending-up-outline',
	users: 'people-outline',
	phone: 'call-outline',
	'file-text': 'document-text-outline',
	kanban: 'albums-outline',
	code: 'code-slash-outline',
	terminal: 'terminal-outline',
	'git-branch': 'git-branch-outline',
	'git-merge': 'git-merge-outline',
	database: 'server-outline',
	server: 'server-outline',
	cloud: 'cloud-outline',
	cpu: 'hardware-chip-outline',
	bug: 'bug-outline',
	package: 'cube-outline',
	wrench: 'construct-outline',
	settings: 'settings-outline',
	shield: 'shield-outline',
	lock: 'lock-closed-outline',
	key: 'key-outline',
	music: 'musical-notes-outline',
	video: 'videocam-outline',
	film: 'film-outline',
	image: 'image-outline',
	camera: 'camera-outline',
	headphones: 'headset-outline',
	mic: 'mic-outline',
	tv: 'tv-outline',
	palette: 'color-palette-outline',
	'book-open': 'book-outline',
	book: 'book-outline',
	newspaper: 'newspaper-outline',
	library: 'library-outline',
	rss: 'logo-rss',
	'bookmark-check': 'bookmark-outline',
	'shopping-cart': 'cart-outline',
	'shopping-bag': 'bag-outline',
	gift: 'gift-outline',
	store: 'storefront-outline',
	'credit-card': 'card-outline',
	receipt: 'receipt-outline',
	plane: 'airplane-outline',
	map: 'map-outline',
	'map-pin': 'location-outline',
	compass: 'compass-outline',
	car: 'car-outline',
	tent: 'bonfire-outline',
	luggage: 'briefcase-outline',
	wallet: 'wallet-outline',
	banknote: 'cash-outline',
	'piggy-bank': 'cash-outline',
	landmark: 'business-outline',
	coins: 'cash-outline',
	calculator: 'calculator-outline',
	'message-circle': 'chatbubble-outline',
	'message-square': 'chatbox-outline',
	share: 'share-social-outline',
	'thumbs-up': 'thumbs-up-outline',
	user: 'person-outline',
	megaphone: 'megaphone-outline',
	home: 'home-outline',
	sofa: 'home-outline',
	bed: 'bed-outline',
	wifi: 'wifi-outline',
	activity: 'pulse-outline',
	dumbbell: 'barbell-outline',
	stethoscope: 'medkit-outline',
	pill: 'medkit-outline',
	brain: 'bulb-outline',
	'graduation-cap': 'school-outline',
	school: 'school-outline',
	pencil: 'pencil-outline',
	notebook: 'journal-outline',
	languages: 'language-outline',
	flask: 'flask-outline',
	gamepad: 'game-controller-outline',
	dices: 'dice-outline',
	trophy: 'trophy-outline',
	utensils: 'restaurant-outline',
	coffee: 'cafe-outline',
	pizza: 'pizza-outline',
	'cooking-pot': 'restaurant-outline',
	leaf: 'leaf-outline',
	trees: 'leaf-outline',
	sun: 'sunny-outline',
	moon: 'moon-outline',
	flower: 'flower-outline',
	mountain: 'trail-sign-outline',
	cat: 'paw-outline',
	dog: 'paw-outline',
};

/**
The glyph for a column's icon id. A missing or unknown id gets the plain folder.
*/
export function columnGlyph(icon: string | undefined): IconName {
	const glyph = icon
		? (GLYPHS as Partial<Record<string, IconName>>)[icon]
		: undefined;
	return glyph ?? 'folder-outline';
}

/**
Every icon a column can use, in the extension's order, with the glyph this app draws for it.
*/
export const COLUMN_ICONS: Array<{id: IconId; glyph: IconName}> = ICON_IDS.map(
	(id) => ({id, glyph: GLYPHS[id]}),
);

/**
Gives a column or folder chip its icon and a steady color taken from its name, so each one is easy to spot.
*/
export function useChipLook() {
	const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
	return <Item extends {icon?: string; name: string}>(item: Item) => ({
		...item,
		glyph: columnGlyph(item.icon),
		tint: avatarColor(item.name, scheme),
	});
}
