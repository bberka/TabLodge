import {ICON_IDS, type IconId} from './icon-ids';
import {rankByQuery, searchTerms} from './fuzzy';

export type IconCategory =
	| 'general'
	| 'work'
	| 'dev'
	| 'media'
	| 'reading'
	| 'shopping'
	| 'travel'
	| 'finance'
	| 'social'
	| 'home'
	| 'health'
	| 'education'
	| 'games'
	| 'food'
	| 'nature';

export type IconInfo = {
	id: IconId;
	label: string;
	category: IconCategory;
	keywords: string;
};

/**
What each icon is called and searched by. Free of any drawing code, so the phone app shares it with the extension.
Keyed by id, so adding an id to ICON_IDS without an entry here fails to compile.
*/
export const ICON_INFO_DATA: Record<
	IconId,
	{category: IconCategory; keywords: string}
> = {
	bookmark: {category: 'general', keywords: 'save favorite saved'},
	folder: {category: 'general', keywords: 'directory files'},
	star: {category: 'general', keywords: 'favorite best rating'},
	heart: {category: 'general', keywords: 'love like favorite'},
	pin: {category: 'general', keywords: 'pinned keep'},
	flag: {category: 'general', keywords: 'mark report'},
	tag: {category: 'general', keywords: 'label category'},
	bell: {category: 'general', keywords: 'notification alert'},
	clock: {category: 'general', keywords: 'time later recent'},
	calendar: {category: 'general', keywords: 'date schedule'},
	lightbulb: {category: 'general', keywords: 'idea tip'},
	zap: {category: 'general', keywords: 'fast lightning power'},
	sparkles: {category: 'general', keywords: 'magic new ai'},
	archive: {category: 'general', keywords: 'storage box old'},
	inbox: {category: 'general', keywords: 'mail incoming'},
	link: {category: 'general', keywords: 'url chain'},
	globe: {category: 'general', keywords: 'web world internet'},
	search: {category: 'general', keywords: 'find look'},
	rocket: {category: 'general', keywords: 'launch startup'},
	target: {category: 'general', keywords: 'goal aim'},
	briefcase: {category: 'work', keywords: 'job office business'},
	building: {category: 'work', keywords: 'company office'},
	mail: {category: 'work', keywords: 'email message'},
	clipboard: {category: 'work', keywords: 'todo tasks list'},
	'check-square': {category: 'work', keywords: 'done tasks todo'},
	presentation: {category: 'work', keywords: 'slides meeting'},
	chart: {category: 'work', keywords: 'stats analytics graph'},
	'trending-up': {category: 'work', keywords: 'growth stocks'},
	users: {category: 'work', keywords: 'team people group'},
	phone: {category: 'work', keywords: 'call contact'},
	'file-text': {category: 'work', keywords: 'document notes'},
	kanban: {category: 'work', keywords: 'board project'},
	code: {category: 'dev', keywords: 'programming source'},
	terminal: {category: 'dev', keywords: 'shell console command'},
	'git-branch': {category: 'dev', keywords: 'version control'},
	'git-merge': {category: 'dev', keywords: 'merge pull request'},
	database: {category: 'dev', keywords: 'sql data storage'},
	server: {category: 'dev', keywords: 'hosting backend'},
	cloud: {category: 'dev', keywords: 'hosting online'},
	cpu: {category: 'dev', keywords: 'hardware processor'},
	bug: {category: 'dev', keywords: 'debug issue'},
	package: {category: 'dev', keywords: 'npm library'},
	wrench: {category: 'dev', keywords: 'tools settings fix'},
	settings: {category: 'dev', keywords: 'preferences config gear'},
	shield: {category: 'dev', keywords: 'security protect'},
	lock: {category: 'dev', keywords: 'private password'},
	key: {category: 'dev', keywords: 'password secret'},
	music: {category: 'media', keywords: 'audio songs'},
	video: {category: 'media', keywords: 'film movies'},
	film: {category: 'media', keywords: 'movies cinema'},
	image: {category: 'media', keywords: 'photo picture'},
	camera: {category: 'media', keywords: 'photo'},
	headphones: {category: 'media', keywords: 'audio podcast listen'},
	mic: {category: 'media', keywords: 'record podcast voice'},
	tv: {category: 'media', keywords: 'television streaming'},
	palette: {category: 'media', keywords: 'design art color'},
	'book-open': {category: 'reading', keywords: 'read article'},
	book: {category: 'reading', keywords: 'library'},
	newspaper: {category: 'reading', keywords: 'news articles'},
	library: {category: 'reading', keywords: 'books collection'},
	rss: {category: 'reading', keywords: 'feed blog'},
	'bookmark-check': {category: 'reading', keywords: 'read later'},
	'shopping-cart': {category: 'shopping', keywords: 'buy store'},
	'shopping-bag': {category: 'shopping', keywords: 'buy store'},
	gift: {category: 'shopping', keywords: 'present wishlist'},
	store: {category: 'shopping', keywords: 'shop market'},
	'credit-card': {category: 'shopping', keywords: 'payment'},
	receipt: {category: 'shopping', keywords: 'invoice order'},
	plane: {category: 'travel', keywords: 'flight trip airport'},
	map: {category: 'travel', keywords: 'navigation directions'},
	'map-pin': {category: 'travel', keywords: 'location place'},
	compass: {category: 'travel', keywords: 'explore navigate'},
	car: {category: 'travel', keywords: 'drive auto'},
	tent: {category: 'travel', keywords: 'camping outdoors'},
	luggage: {category: 'travel', keywords: 'suitcase vacation'},
	wallet: {category: 'finance', keywords: 'money'},
	banknote: {category: 'finance', keywords: 'cash money'},
	'piggy-bank': {category: 'finance', keywords: 'savings'},
	landmark: {category: 'finance', keywords: 'bank'},
	coins: {category: 'finance', keywords: 'money currency'},
	calculator: {category: 'finance', keywords: 'math budget'},
	'message-circle': {category: 'social', keywords: 'chat comments'},
	'message-square': {category: 'social', keywords: 'chat forum'},
	share: {category: 'social', keywords: 'send social'},
	'thumbs-up': {category: 'social', keywords: 'like'},
	user: {category: 'social', keywords: 'person profile account'},
	megaphone: {category: 'social', keywords: 'announce marketing'},
	home: {category: 'home', keywords: 'house'},
	sofa: {category: 'home', keywords: 'furniture living'},
	bed: {category: 'home', keywords: 'sleep bedroom'},
	wifi: {category: 'home', keywords: 'internet network'},
	activity: {category: 'health', keywords: 'fitness pulse'},
	dumbbell: {category: 'health', keywords: 'gym workout'},
	stethoscope: {category: 'health', keywords: 'doctor medical'},
	pill: {category: 'health', keywords: 'medicine'},
	brain: {category: 'health', keywords: 'mind mental'},
	'graduation-cap': {category: 'education', keywords: 'school university'},
	school: {category: 'education', keywords: 'class'},
	pencil: {category: 'education', keywords: 'write edit'},
	notebook: {category: 'education', keywords: 'notes journal'},
	languages: {category: 'education', keywords: 'translate language'},
	flask: {category: 'education', keywords: 'science lab'},
	gamepad: {category: 'games', keywords: 'controller gaming'},
	dices: {category: 'games', keywords: 'board game random'},
	trophy: {category: 'games', keywords: 'win award'},
	utensils: {category: 'food', keywords: 'restaurant eat'},
	coffee: {category: 'food', keywords: 'cafe drink'},
	pizza: {category: 'food', keywords: 'fast food'},
	'cooking-pot': {category: 'food', keywords: 'recipe cook'},
	leaf: {category: 'nature', keywords: 'plant eco'},
	trees: {category: 'nature', keywords: 'forest'},
	sun: {category: 'nature', keywords: 'weather day'},
	moon: {category: 'nature', keywords: 'night dark'},
	flower: {category: 'nature', keywords: 'garden'},
	mountain: {category: 'nature', keywords: 'hiking outdoors'},
	cat: {category: 'nature', keywords: 'pet animal'},
	dog: {category: 'nature', keywords: 'pet animal'},
	crown: {category: 'general', keywords: 'king royal premium vip'},
	gem: {category: 'general', keywords: 'diamond jewel precious'},
	award: {category: 'general', keywords: 'prize badge achievement'},
	medal: {category: 'general', keywords: 'winner rank achievement'},
	hourglass: {category: 'general', keywords: 'wait timer time'},
	timer: {category: 'general', keywords: 'stopwatch countdown pomodoro'},
	'alarm-clock': {category: 'general', keywords: 'alarm wake reminder'},
	infinity: {category: 'general', keywords: 'loop endless forever'},
	hash: {category: 'general', keywords: 'number tag hashtag channel'},
	percent: {category: 'general', keywords: 'discount sale rate'},
	layers: {category: 'general', keywords: 'stack levels design'},
	shapes: {category: 'general', keywords: 'geometry design forms'},
	puzzle: {category: 'general', keywords: 'plugin extension game piece'},
	wand: {category: 'general', keywords: 'magic wizard auto'},
	'qr-code': {category: 'general', keywords: 'scan barcode'},
	eye: {category: 'general', keywords: 'view watch visible'},
	hand: {category: 'general', keywords: 'stop wave gesture'},
	handshake: {category: 'work', keywords: 'deal partner agreement'},
	ticket: {category: 'general', keywords: 'event pass coupon'},
	trash: {category: 'general', keywords: 'delete bin garbage remove'},
	save: {category: 'general', keywords: 'disk floppy store'},
	scissors: {category: 'general', keywords: 'cut clip'},
	ruler: {category: 'general', keywords: 'measure size'},
	scale: {category: 'general', keywords: 'balance law weight'},
	gauge: {category: 'general', keywords: 'speed meter performance dashboard'},
	box: {category: 'general', keywords: 'package cube container'},
	boxes: {category: 'general', keywords: 'packages inventory stock'},
	anchor: {category: 'general', keywords: 'ship harbor fixed'},
	'life-buoy': {category: 'general', keywords: 'help support rescue'},
	mailbox: {category: 'work', keywords: 'post letters inbox'},
	contact: {category: 'work', keywords: 'address book person card'},
	table: {category: 'work', keywords: 'spreadsheet grid rows data'},
	printer: {category: 'work', keywords: 'print paper'},
	'file-code': {category: 'dev', keywords: 'source script snippet'},
	'scroll-text': {category: 'work', keywords: 'contract log changelog'},
	vault: {category: 'finance', keywords: 'safe bank secure'},
	warehouse: {category: 'work', keywords: 'storage logistics depot'},
	hospital: {category: 'health', keywords: 'clinic medical doctor'},
	church: {category: 'home', keywords: 'religion worship'},
	castle: {category: 'games', keywords: 'fortress medieval'},
	hotel: {category: 'travel', keywords: 'stay booking lodging'},
	bot: {category: 'dev', keywords: 'robot assistant chatbot ai agent'},
	binary: {category: 'dev', keywords: 'bits zero one data'},
	braces: {category: 'dev', keywords: 'json curly code'},
	blocks: {category: 'dev', keywords: 'modules lego building'},
	'circuit-board': {category: 'dev', keywords: 'electronics hardware pcb'},
	cog: {category: 'dev', keywords: 'gear settings machine'},
	command: {category: 'dev', keywords: 'cmd key shortcut mac'},
	container: {category: 'dev', keywords: 'docker kubernetes deploy'},
	webhook: {category: 'dev', keywords: 'api callback integration'},
	keyboard: {category: 'dev', keywords: 'typing keys input'},
	laptop: {category: 'dev', keywords: 'computer notebook device'},
	monitor: {category: 'dev', keywords: 'screen display desktop computer'},
	smartphone: {category: 'dev', keywords: 'mobile phone android ios device'},
	tablet: {category: 'dev', keywords: 'ipad device'},
	'hard-drive': {category: 'dev', keywords: 'disk storage ssd backup'},
	network: {category: 'dev', keywords: 'graph nodes connections lan'},
	router: {category: 'dev', keywords: 'wifi modem internet'},
	signal: {category: 'dev', keywords: 'bars reception strength'},
	bluetooth: {category: 'dev', keywords: 'wireless pairing'},
	radio: {category: 'media', keywords: 'podcast broadcast fm audio'},
	plug: {category: 'dev', keywords: 'power socket connect'},
	battery: {category: 'dev', keywords: 'power charge energy'},
	satellite: {category: 'dev', keywords: 'orbit space gps'},
	workflow: {category: 'dev', keywords: 'pipeline automation flow ci'},
	'mouse-pointer': {category: 'dev', keywords: 'cursor click'},
	funnel: {category: 'dev', keywords: 'filter sales'},
	radar: {category: 'dev', keywords: 'scan detect monitor'},
	paintbrush: {category: 'media', keywords: 'design art paint'},
	pipette: {category: 'media', keywords: 'color picker eyedropper'},
	crop: {category: 'media', keywords: 'photo edit resize'},
	aperture: {category: 'media', keywords: 'photography lens camera'},
	clapperboard: {category: 'media', keywords: 'movie film director'},
	disc: {category: 'media', keywords: 'cd album record vinyl'},
	speaker: {category: 'media', keywords: 'audio sound volume'},
	guitar: {category: 'media', keywords: 'music band instrument'},
	piano: {category: 'media', keywords: 'music keys instrument'},
	popcorn: {category: 'media', keywords: 'movie cinema snack'},
	drama: {category: 'media', keywords: 'theatre theater masks acting'},
	shirt: {category: 'shopping', keywords: 'clothes fashion apparel'},
	glasses: {category: 'shopping', keywords: 'eyewear sunglasses reading'},
	watch: {category: 'shopping', keywords: 'wristwatch time accessory'},
	backpack: {category: 'travel', keywords: 'bag school hiking'},
	bike: {category: 'travel', keywords: 'bicycle cycling ride'},
	bus: {category: 'travel', keywords: 'transit public transport'},
	train: {category: 'travel', keywords: 'rail metro subway transit'},
	truck: {category: 'travel', keywords: 'delivery shipping freight'},
	ship: {category: 'travel', keywords: 'boat cruise sea'},
	sailboat: {category: 'travel', keywords: 'sailing yacht sea'},
	tractor: {category: 'nature', keywords: 'farm agriculture'},
	fuel: {category: 'travel', keywords: 'gas petrol station'},
	footprints: {category: 'travel', keywords: 'walking steps hike'},
	telescope: {category: 'education', keywords: 'astronomy stars space'},
	umbrella: {category: 'nature', keywords: 'rain weather'},
	earth: {category: 'travel', keywords: 'world planet globe'},
	syringe: {category: 'health', keywords: 'vaccine medicine shot'},
	thermometer: {category: 'health', keywords: 'temperature fever weather'},
	'heart-pulse': {category: 'health', keywords: 'heartbeat cardio fitness'},
	bandage: {category: 'health', keywords: 'first aid injury'},
	ear: {category: 'health', keywords: 'hearing listen'},
	bone: {category: 'health', keywords: 'skeleton'},
	microscope: {category: 'education', keywords: 'science lab research'},
	baby: {category: 'home', keywords: 'child kid infant'},
	atom: {category: 'education', keywords: 'physics science chemistry'},
	dna: {category: 'education', keywords: 'biology genetics'},
	scroll: {category: 'education', keywords: 'history parchment'},
	swords: {category: 'games', keywords: 'fight battle combat'},
	joystick: {category: 'games', keywords: 'controller arcade'},
	bomb: {category: 'games', keywords: 'explosive boom'},
	skull: {category: 'games', keywords: 'death danger spooky'},
	ghost: {category: 'games', keywords: 'halloween spooky'},
	cake: {category: 'food', keywords: 'birthday dessert party'},
	cookie: {category: 'food', keywords: 'biscuit snack dessert'},
	candy: {category: 'food', keywords: 'sweet sugar'},
	egg: {category: 'food', keywords: 'breakfast'},
	fish: {category: 'food', keywords: 'seafood sushi'},
	salad: {category: 'food', keywords: 'healthy vegetables vegan'},
	wine: {category: 'food', keywords: 'drink glass alcohol'},
	beer: {category: 'food', keywords: 'drink pub bar'},
	milk: {category: 'food', keywords: 'dairy drink'},
	soup: {category: 'food', keywords: 'bowl meal'},
	sandwich: {category: 'food', keywords: 'lunch sub'},
	hamburger: {category: 'food', keywords: 'burger fast food'},
	carrot: {category: 'food', keywords: 'vegetable'},
	banana: {category: 'food', keywords: 'fruit'},
	grape: {category: 'food', keywords: 'fruit wine'},
	cherry: {category: 'food', keywords: 'fruit'},
	wheat: {category: 'food', keywords: 'bread grain farm'},
	'ice-cream': {category: 'food', keywords: 'dessert cone sweet'},
	'chef-hat': {category: 'food', keywords: 'cooking recipe kitchen'},
	flame: {category: 'nature', keywords: 'fire hot trending'},
	snowflake: {category: 'nature', keywords: 'winter cold ice'},
	droplet: {category: 'nature', keywords: 'water rain liquid'},
	wind: {category: 'nature', keywords: 'air breeze weather'},
	sprout: {category: 'nature', keywords: 'plant grow seedling'},
	clover: {category: 'nature', keywords: 'luck lucky green'},
	rabbit: {category: 'nature', keywords: 'bunny animal pet'},
	squirrel: {category: 'nature', keywords: 'animal'},
	bird: {category: 'nature', keywords: 'animal twitter fly'},
	turtle: {category: 'nature', keywords: 'animal slow'},
	'paw-print': {category: 'nature', keywords: 'pet animal track'},
	rainbow: {category: 'nature', keywords: 'colors weather pride'},
};

const titleCase = (id: string) =>
	id
		.split('-')
		.map((part) => part[0].toUpperCase() + part.slice(1))
		.join(' ');

export const ICON_INFOS: readonly IconInfo[] = ICON_IDS.map((id) => ({
	id,
	label: titleCase(id),
	...ICON_INFO_DATA[id],
}));

function isSubsequence(word: string, text: string) {
	let index = 0;
	for (const char of text) {
		if (char === word[index]) {
			index += 1;
		}
	}

	return index === word.length;
}

/**
Ranks icons with the shared fuzzy matcher over name, keywords and category: whole words and prefixes first,
then initials, letters in order and one-letter typos ("bokmark"). Every query word must match. When nothing
matches, a loose subsequence of the id ("gtbr" for git-branch) is the last resort.
*/
export function searchIconInfos(query: string): readonly IconInfo[] {
	if (searchTerms(query).length === 0) {
		return ICON_INFOS;
	}

	const ranked = rankByQuery(query, ICON_INFOS, (icon) => [
		icon.label,
		icon.keywords,
		icon.category,
	]);
	if (ranked.length > 0) {
		return ranked;
	}

	const compact = query.toLocaleLowerCase().replaceAll(/\s+/g, '');
	return compact.length > 3
		? ICON_INFOS.filter((icon) =>
				isSubsequence(compact, icon.id.replaceAll('-', '')),
			)
		: [];
}
