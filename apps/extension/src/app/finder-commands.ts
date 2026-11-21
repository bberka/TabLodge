// The finder's commands, one list for every place the finder opens: the dashboard and new tab page (newtab.tsx), and
// the palette window or overlay the browser shortcut opens over any page (palette.tsx). A page supplies how to run
// each command, and leaves out only what cannot work there, with the reason next to it.
import {
	ArchiveRestore,
	BookmarkPlus,
	Download,
	FileText,
	FolderPlus,
	HardDriveDownload,
	HelpCircle,
	History,
	Home,
	Inbox,
	KeyRound,
	Link2,
	Lock,
	RefreshCw,
	Save,
	Settings as SettingsIcon,
	Share2,
	SquarePlus,
	SunMoon,
	Trash2,
	Upload,
	type LucideIcon,
} from 'lucide-react';
import {isFirefox} from '../shared/browser';
import type {FinderAction} from './finder';
import {sectionId} from './settings-sections';

type CommandSpec = {
	id: string;
	title: string;
	keywords: readonly string[];
	icon: LucideIcon;
	/**
	A page of the extension the command opens, the same from everywhere.
	*/
	opens?: string;
};

const COMMANDS = [
	// The first eight are what the finder lists before anything is typed.
	{
		id: 'save-window',
		title: 'Save this window',
		keywords: ['session', 'tabs', 'store'],
		icon: Save,
	},
	{
		id: 'keep-copy',
		title: 'Keep a copy of this page',
		keywords: ['page copy', 'offline', 'reader', 'archive', 'read later'],
		icon: FileText,
	},
	{
		id: 'new-bookmark',
		title: 'New bookmark',
		keywords: ['add', 'link'],
		icon: BookmarkPlus,
	},
	{
		id: 'new-column',
		title: 'New column',
		keywords: ['bookmark', 'add'],
		icon: SquarePlus,
	},
	{
		id: 'new-folder',
		title: 'New session folder',
		keywords: ['add', 'sessions'],
		icon: FolderPlus,
	},
	{
		id: 'sync-now',
		title: 'Sync now',
		keywords: ['server', 'devices', 'update', 'refresh'],
		icon: RefreshCw,
	},
	{
		id: 'back-up-now',
		title: 'Back up now',
		keywords: ['backup', 'recovery', 'save copy', 'library'],
		icon: HardDriveDownload,
	},
	{
		id: 'open-trash',
		title: 'Trash bin',
		keywords: ['deleted', 'undo', 'restore', 'bin', 'recover'],
		icon: Trash2,
	},
	{
		id: 'share-bookmarks',
		title: 'Share bookmarks',
		keywords: ['share as', 'export', 'link', 'html', 'markdown', 'publish'],
		icon: Share2,
	},
	{
		id: 'import-bookmarks',
		title: 'Import',
		keywords: [
			'import bookmarks',
			'restore',
			'load',
			'upload',
			'file',
			'from a link',
			'shared page',
		],
		icon: Upload,
	},
	{
		id: 'shared-pages',
		title: 'Shared pages',
		keywords: [
			'share link',
			'public',
			'published',
			'delete link',
			'get a link',
		],
		icon: Link2,
	},
	{
		id: 'backup-bookmarks',
		title: 'Back up bookmarks',
		keywords: ['export', 'download', 'save'],
		icon: Download,
	},
	{
		id: 'import-sessions',
		title: 'Import sessions',
		keywords: ['restore', 'load', 'upload'],
		icon: ArchiveRestore,
	},
	{
		id: 'backup-sessions',
		title: 'Back up sessions',
		keywords: ['export', 'download', 'save'],
		icon: HardDriveDownload,
	},
	{
		id: 'recent-snapshots',
		title: 'Recent snapshots',
		keywords: ['crash', 'recover', 'restore session', 'history', 'windows'],
		icon: History,
	},
	{
		id: 'restore-backup',
		title: 'Restore from a backup',
		keywords: ['backups', 'recovery', 'undo'],
		icon: ArchiveRestore,
		opens: `options.html#${sectionId('Recovery & backups')}`,
	},
	{
		id: 'add-site-source',
		title: 'Add a site source',
		keywords: ['sources', 'reddit', 'youtube', 'github', 'saved list'],
		icon: Inbox,
		opens: `options.html#${sectionId('Sources')}`,
	},
	{
		id: 'lock-private',
		title: 'Lock the private library',
		keywords: ['private', 'incognito', 'password', 'lock now'],
		icon: Lock,
	},
	{
		id: 'change-private-password',
		title: 'Change the private library password',
		keywords: ['private', 'incognito', 'lock', 'passcode'],
		icon: KeyRound,
		opens: `options.html#${sectionId('Private windows')}`,
	},
	{
		id: 'toggle-theme',
		title: 'Toggle light/dark theme',
		keywords: ['appearance', 'dark mode', 'light mode'],
		icon: SunMoon,
	},
	{
		id: 'open-dashboard',
		title: 'Open dashboard',
		keywords: ['home', 'new tab', 'sessions', 'bookmarks'],
		icon: Home,
	},
	{
		id: 'open-settings',
		title: 'Open Settings',
		keywords: ['options', 'preferences'],
		icon: SettingsIcon,
		opens: 'options.html',
	},
	{
		id: 'open-help',
		title: 'Open Help',
		keywords: ['shortcuts', 'about', 'guide', 'docs'],
		icon: HelpCircle,
		opens: 'help.html',
	},
] as const satisfies readonly CommandSpec[];

type Command = (typeof COMMANDS)[number];
export type FinderCommandId = Command['id'];
/**
The commands a page runs itself, as opposed to the ones that open a page of the extension.
*/
export type PageCommandId = Exclude<Command, {opens: string}>['id'];
type Run = () => void | Promise<void>;

/**
How a page runs each of its commands. `undefined` leaves the command out of that page's finder; every page names
every command, so a new one cannot be forgotten.
*/
export type CommandHandlers = Record<PageCommandId, Run | undefined>;

const NOT_ON_FIREFOX = new Set<FinderCommandId>([
	// Firefox keeps the add-on out of private windows, so there is no private library to manage.
	'lock-private',
	'change-private-password',
]);

export function finderActions(
	handlers: CommandHandlers,
	openPage: (path: string) => void | Promise<void>,
): FinderAction[] {
	return COMMANDS.flatMap((command: Command): FinderAction[] => {
		if (isFirefox && NOT_ON_FIREFOX.has(command.id)) {
			return [];
		}

		const {id, title, keywords, icon} = command;
		const run: Run | undefined =
			'opens' in command
				? async () => openPage(command.opens)
				: handlers[command.id];
		return run
			? [
					{
						id,
						title,
						keywords,
						icon,
						run,
					},
				]
			: [];
	});
}
