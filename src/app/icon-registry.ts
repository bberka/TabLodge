import {
	Activity,
	Archive,
	Banknote,
	Bed,
	Bell,
	Book,
	BookOpen,
	Bookmark,
	BookmarkCheck,
	Brain,
	Briefcase,
	Bug,
	Building2,
	Calculator,
	Calendar,
	Camera,
	Car,
	Cat,
	ChartColumn,
	ClipboardList,
	Clock,
	Cloud,
	Code,
	Coffee,
	Coins,
	Compass,
	CookingPot,
	Cpu,
	CreditCard,
	Database,
	Dices,
	Dog,
	Dumbbell,
	FileText,
	Film,
	Flag,
	FlaskConical,
	Flower2,
	Folder,
	Gamepad2,
	Gift,
	GitBranch,
	GitMerge,
	Globe,
	GraduationCap,
	Headphones,
	Heart,
	House,
	Image,
	Inbox,
	Kanban,
	Key,
	Landmark,
	Languages,
	Leaf,
	Library,
	Lightbulb,
	Link,
	Lock,
	Luggage,
	Mail,
	Map as MapIcon,
	MapPin,
	Megaphone,
	MessageCircle,
	MessageSquare,
	Mic,
	Moon,
	Mountain,
	Music,
	Newspaper,
	NotebookPen,
	Package,
	Palette,
	Pencil,
	Phone,
	PiggyBank,
	Pill,
	Pin,
	Pizza,
	Plane,
	Presentation,
	Receipt,
	Rocket,
	Rss,
	School,
	Search,
	Server,
	Settings,
	Share2,
	Shield,
	ShoppingBag,
	ShoppingCart,
	Sofa,
	Sparkles,
	SquareCheck,
	Star,
	Stethoscope,
	Store,
	Sun,
	Tag,
	Target,
	Tent,
	Terminal,
	ThumbsUp,
	Trees,
	TrendingUp,
	Trophy,
	Tv,
	User,
	Users,
	Utensils,
	Video,
	Wallet,
	Wifi,
	Wrench,
	Zap,
	type LucideIcon,
} from 'lucide-react';
import {ICON_IDS, type IconId} from './icon-ids';

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

export type IconEntry = {
	id: IconId;
	label: string;
	category: IconCategory;
	keywords: string;
	component: LucideIcon;
};

export const DEFAULT_COLUMN_ICON: IconId = 'bookmark';
export const DEFAULT_FOLDER_ICON: IconId = 'folder';

export const ICON_CATEGORIES: ReadonlyArray<{id: IconCategory; label: string}> =
	[
		{id: 'general', label: 'General'},
		{id: 'work', label: 'Work'},
		{id: 'dev', label: 'Dev'},
		{id: 'media', label: 'Media'},
		{id: 'reading', label: 'Reading'},
		{id: 'shopping', label: 'Shopping'},
		{id: 'travel', label: 'Travel'},
		{id: 'finance', label: 'Finance'},
		{id: 'social', label: 'Social'},
		{id: 'home', label: 'Home'},
		{id: 'health', label: 'Health'},
		{id: 'education', label: 'Education'},
		{id: 'games', label: 'Games'},
		{id: 'food', label: 'Food'},
		{id: 'nature', label: 'Nature'},
	];

// Keyed by id, so adding an id to ICON_IDS without an entry here fails to compile.
const DEFINITIONS: Record<
	IconId,
	{category: IconCategory; keywords: string; component: LucideIcon}
> = {
	bookmark: {
		category: 'general',
		keywords: 'save favorite saved',
		component: Bookmark,
	},
	folder: {category: 'general', keywords: 'directory files', component: Folder},
	star: {
		category: 'general',
		keywords: 'favorite best rating',
		component: Star,
	},
	heart: {
		category: 'general',
		keywords: 'love like favorite',
		component: Heart,
	},
	pin: {category: 'general', keywords: 'pinned keep', component: Pin},
	flag: {category: 'general', keywords: 'mark report', component: Flag},
	tag: {category: 'general', keywords: 'label category', component: Tag},
	bell: {category: 'general', keywords: 'notification alert', component: Bell},
	clock: {category: 'general', keywords: 'time later recent', component: Clock},
	calendar: {
		category: 'general',
		keywords: 'date schedule',
		component: Calendar,
	},
	lightbulb: {category: 'general', keywords: 'idea tip', component: Lightbulb},
	zap: {category: 'general', keywords: 'fast lightning power', component: Zap},
	sparkles: {
		category: 'general',
		keywords: 'magic new ai',
		component: Sparkles,
	},
	archive: {
		category: 'general',
		keywords: 'storage box old',
		component: Archive,
	},
	inbox: {category: 'general', keywords: 'mail incoming', component: Inbox},
	link: {category: 'general', keywords: 'url chain', component: Link},
	globe: {
		category: 'general',
		keywords: 'web world internet',
		component: Globe,
	},
	search: {category: 'general', keywords: 'find look', component: Search},
	rocket: {category: 'general', keywords: 'launch startup', component: Rocket},
	target: {category: 'general', keywords: 'goal aim', component: Target},
	briefcase: {
		category: 'work',
		keywords: 'job office business',
		component: Briefcase,
	},
	building: {
		category: 'work',
		keywords: 'company office',
		component: Building2,
	},
	mail: {category: 'work', keywords: 'email message', component: Mail},
	clipboard: {
		category: 'work',
		keywords: 'todo tasks list',
		component: ClipboardList,
	},
	'check-square': {
		category: 'work',
		keywords: 'done tasks todo',
		component: SquareCheck,
	},
	presentation: {
		category: 'work',
		keywords: 'slides meeting',
		component: Presentation,
	},
	chart: {
		category: 'work',
		keywords: 'stats analytics graph',
		component: ChartColumn,
	},
	'trending-up': {
		category: 'work',
		keywords: 'growth stocks',
		component: TrendingUp,
	},
	users: {category: 'work', keywords: 'team people group', component: Users},
	phone: {category: 'work', keywords: 'call contact', component: Phone},
	'file-text': {
		category: 'work',
		keywords: 'document notes',
		component: FileText,
	},
	kanban: {category: 'work', keywords: 'board project', component: Kanban},
	code: {category: 'dev', keywords: 'programming source', component: Code},
	terminal: {
		category: 'dev',
		keywords: 'shell console command',
		component: Terminal,
	},
	'git-branch': {
		category: 'dev',
		keywords: 'version control',
		component: GitBranch,
	},
	'git-merge': {
		category: 'dev',
		keywords: 'merge pull request',
		component: GitMerge,
	},
	database: {
		category: 'dev',
		keywords: 'sql data storage',
		component: Database,
	},
	server: {category: 'dev', keywords: 'hosting backend', component: Server},
	cloud: {category: 'dev', keywords: 'hosting online', component: Cloud},
	cpu: {category: 'dev', keywords: 'hardware processor', component: Cpu},
	bug: {category: 'dev', keywords: 'debug issue', component: Bug},
	package: {category: 'dev', keywords: 'npm library', component: Package},
	wrench: {category: 'dev', keywords: 'tools settings fix', component: Wrench},
	settings: {
		category: 'dev',
		keywords: 'preferences config gear',
		component: Settings,
	},
	shield: {category: 'dev', keywords: 'security protect', component: Shield},
	lock: {category: 'dev', keywords: 'private password', component: Lock},
	key: {category: 'dev', keywords: 'password secret', component: Key},
	music: {category: 'media', keywords: 'audio songs', component: Music},
	video: {category: 'media', keywords: 'film movies', component: Video},
	film: {category: 'media', keywords: 'movies cinema', component: Film},
	image: {category: 'media', keywords: 'photo picture', component: Image},
	camera: {category: 'media', keywords: 'photo', component: Camera},
	headphones: {
		category: 'media',
		keywords: 'audio podcast listen',
		component: Headphones,
	},
	mic: {category: 'media', keywords: 'record podcast voice', component: Mic},
	tv: {category: 'media', keywords: 'television streaming', component: Tv},
	palette: {
		category: 'media',
		keywords: 'design art color',
		component: Palette,
	},
	'book-open': {
		category: 'reading',
		keywords: 'read article',
		component: BookOpen,
	},
	book: {category: 'reading', keywords: 'library', component: Book},
	newspaper: {
		category: 'reading',
		keywords: 'news articles',
		component: Newspaper,
	},
	library: {
		category: 'reading',
		keywords: 'books collection',
		component: Library,
	},
	rss: {category: 'reading', keywords: 'feed blog', component: Rss},
	'bookmark-check': {
		category: 'reading',
		keywords: 'read later',
		component: BookmarkCheck,
	},
	'shopping-cart': {
		category: 'shopping',
		keywords: 'buy store',
		component: ShoppingCart,
	},
	'shopping-bag': {
		category: 'shopping',
		keywords: 'buy store',
		component: ShoppingBag,
	},
	gift: {category: 'shopping', keywords: 'present wishlist', component: Gift},
	store: {category: 'shopping', keywords: 'shop market', component: Store},
	'credit-card': {
		category: 'shopping',
		keywords: 'payment',
		component: CreditCard,
	},
	receipt: {
		category: 'shopping',
		keywords: 'invoice order',
		component: Receipt,
	},
	plane: {
		category: 'travel',
		keywords: 'flight trip airport',
		component: Plane,
	},
	map: {
		category: 'travel',
		keywords: 'navigation directions',
		component: MapIcon,
	},
	'map-pin': {
		category: 'travel',
		keywords: 'location place',
		component: MapPin,
	},
	compass: {
		category: 'travel',
		keywords: 'explore navigate',
		component: Compass,
	},
	car: {category: 'travel', keywords: 'drive auto', component: Car},
	tent: {category: 'travel', keywords: 'camping outdoors', component: Tent},
	luggage: {
		category: 'travel',
		keywords: 'suitcase vacation',
		component: Luggage,
	},
	wallet: {category: 'finance', keywords: 'money', component: Wallet},
	banknote: {category: 'finance', keywords: 'cash money', component: Banknote},
	'piggy-bank': {
		category: 'finance',
		keywords: 'savings',
		component: PiggyBank,
	},
	landmark: {category: 'finance', keywords: 'bank', component: Landmark},
	coins: {category: 'finance', keywords: 'money currency', component: Coins},
	calculator: {
		category: 'finance',
		keywords: 'math budget',
		component: Calculator,
	},
	'message-circle': {
		category: 'social',
		keywords: 'chat comments',
		component: MessageCircle,
	},
	'message-square': {
		category: 'social',
		keywords: 'chat forum',
		component: MessageSquare,
	},
	share: {category: 'social', keywords: 'send social', component: Share2},
	'thumbs-up': {category: 'social', keywords: 'like', component: ThumbsUp},
	user: {
		category: 'social',
		keywords: 'person profile account',
		component: User,
	},
	megaphone: {
		category: 'social',
		keywords: 'announce marketing',
		component: Megaphone,
	},
	home: {category: 'home', keywords: 'house', component: House},
	sofa: {category: 'home', keywords: 'furniture living', component: Sofa},
	bed: {category: 'home', keywords: 'sleep bedroom', component: Bed},
	wifi: {category: 'home', keywords: 'internet network', component: Wifi},
	activity: {
		category: 'health',
		keywords: 'fitness pulse',
		component: Activity,
	},
	dumbbell: {category: 'health', keywords: 'gym workout', component: Dumbbell},
	stethoscope: {
		category: 'health',
		keywords: 'doctor medical',
		component: Stethoscope,
	},
	pill: {category: 'health', keywords: 'medicine', component: Pill},
	brain: {category: 'health', keywords: 'mind mental', component: Brain},
	'graduation-cap': {
		category: 'education',
		keywords: 'school university',
		component: GraduationCap,
	},
	school: {category: 'education', keywords: 'class', component: School},
	pencil: {category: 'education', keywords: 'write edit', component: Pencil},
	notebook: {
		category: 'education',
		keywords: 'notes journal',
		component: NotebookPen,
	},
	languages: {
		category: 'education',
		keywords: 'translate language',
		component: Languages,
	},
	flask: {
		category: 'education',
		keywords: 'science lab',
		component: FlaskConical,
	},
	gamepad: {
		category: 'games',
		keywords: 'controller gaming',
		component: Gamepad2,
	},
	dices: {category: 'games', keywords: 'board game random', component: Dices},
	trophy: {category: 'games', keywords: 'win award', component: Trophy},
	utensils: {category: 'food', keywords: 'restaurant eat', component: Utensils},
	coffee: {category: 'food', keywords: 'cafe drink', component: Coffee},
	pizza: {category: 'food', keywords: 'fast food', component: Pizza},
	'cooking-pot': {
		category: 'food',
		keywords: 'recipe cook',
		component: CookingPot,
	},
	leaf: {category: 'nature', keywords: 'plant eco', component: Leaf},
	trees: {category: 'nature', keywords: 'forest', component: Trees},
	sun: {category: 'nature', keywords: 'weather day', component: Sun},
	moon: {category: 'nature', keywords: 'night dark', component: Moon},
	flower: {category: 'nature', keywords: 'garden', component: Flower2},
	mountain: {
		category: 'nature',
		keywords: 'hiking outdoors',
		component: Mountain,
	},
	cat: {category: 'nature', keywords: 'pet animal', component: Cat},
	dog: {category: 'nature', keywords: 'pet animal', component: Dog},
};

const titleCase = (id: string) =>
	id
		.split('-')
		.map((part) => part[0].toUpperCase() + part.slice(1))
		.join(' ');

export const ICONS: readonly IconEntry[] = ICON_IDS.map((id) => ({
	id,
	label: titleCase(id),
	...DEFINITIONS[id],
}));

const BY_ID = new Map<string, IconEntry>(ICONS.map((icon) => [icon.id, icon]));

export const isIconId = (value: unknown): value is IconId =>
	typeof value === 'string' && BY_ID.has(value);

/**
The icon for a stored id; unknown, missing or removed ids fall back to `fallback`.
*/
export function getIcon(
	id: string | null | undefined,
	fallback: IconId = DEFAULT_COLUMN_ICON,
): IconEntry {
	return BY_ID.get(id ?? '') ?? BY_ID.get(fallback)!;
}

const normalize = (value: string) => value.toLocaleLowerCase().trim();

/**
Filters icons by every query word: a match in the id or keywords scores best, a subsequence ("gtbr" for git-branch) scores lower.
*/
export function searchIcons(query: string): readonly IconEntry[] {
	const words = normalize(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return ICONS;
	}

	const scored: Array<{icon: IconEntry; score: number}> = [];
	for (const icon of ICONS) {
		const haystack = `${icon.id.replaceAll('-', ' ')} ${icon.keywords} ${icon.category}`;
		let total = 0;
		for (const word of words) {
			const score = scoreWord(icon, haystack, word);
			if (score === 0) {
				total = 0;
				break;
			}

			total += score;
		}

		if (total > 0) {
			scored.push({icon, score: total});
		}
	}

	return scored
		.toSorted((a, b) => b.score - a.score)
		.map((entry) => entry.icon);
}

function scoreWord(icon: IconEntry, haystack: string, word: string) {
	if (icon.id === word) {
		return 100;
	}

	if (icon.id.startsWith(word)) {
		return 60;
	}

	if (haystack.split(' ').some((part) => part.startsWith(word))) {
		return 40;
	}

	if (haystack.includes(word)) {
		return 20;
	}

	return word.length > 2 && isSubsequence(word, icon.id.replaceAll('-', ''))
		? 5
		: 0;
}

function isSubsequence(word: string, text: string) {
	let index = 0;
	for (const char of text) {
		if (char === word[index]) {
			index += 1;
		}
	}

	return index === word.length;
}
