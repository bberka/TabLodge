import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
	ArrowUpRight,
	BookOpen,
	Bug,
	Database,
	Github,
	Globe,
	Info,
	Keyboard,
	Layers2,
	LockKeyhole,
	MousePointer2,
	MousePointerClick,
	RotateCcw,
	Scale,
	Settings2,
	Tag,
} from 'lucide-react';
import {
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	TooltipProvider,
} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider} from '../shared/theme';
import {AppHeader, openShortcutsPage} from './common';
import {PROJECT} from './project';

const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

function Help() {
	const [shortcutsFailed, setShortcutsFailed] = useState(false);
	const sections = [
		{
			icon: MousePointer2,
			title: 'Quick actions',
			text: 'The toolbar button opens a compact popup by default. Choose tabs and a session title without leaving it, or use Open Dashboard to open the full page in a separate tab. Settings can instead assign the toolbar button to save the current selection/window, the full window with tab groups, the active group, the active tab, all windows, or the active tab into the first unlocked session. A separate save preference can open the saved session afterward.',
		},
		{
			icon: Layers2,
			title: 'Saving sessions',
			text: `Save from the popup, the right-click menus, or a keyboard shortcut. Sessions retain tab titles, notes, URLs, pinned state when opted in, and Chromium tab-group metadata. Pinned tabs are excluded by default; when enabled, ${PROJECT.name} stores them before any close operation.`,
			detail:
				'The quick chooser starts with the selected tabs (or eligible tabs in the window) checked. Review the list and title before saving.',
		},
		{
			icon: RotateCcw,
			title: 'Restoring sessions',
			text: 'Choose whether restored tabs stay in the session, are removed after a successful restore, or the session is archived. Locked sessions always keep their tabs. Set a default destination in Settings and override it for individual sessions. Tabs saved from a split view reopen side by side in Chromium-based browsers version 155 or newer, or as neighboring tabs if you choose that in Settings or the browser cannot split them.',
			detail: `Restore modifiers: Ctrl/Cmd-click keeps the saved session, Alt-click archives it, and Shift-click opens a new window. For a single tab, Settings controls whether ${PROJECT.name} switches to it or stays on the current page.`,
		},
		{
			icon: LockKeyhole,
			title: 'Archive and lock',
			text: 'Use the visible archive and lock controls on a session. Archived sessions are kept in the Archived view until unarchived or deleted. A locked session can still be restored, but restore actions will not remove its saved tabs.',
		},
		{
			icon: BookOpen,
			title: 'Bookmarks',
			text: 'Save the current page from the popup or the right-click menus, or add a bookmark directly. Drag bookmarks between columns to reorder or move them; insertion feedback shows where the bookmark will land. Drag a browser link or a session link onto a column to save it at that position.',
			detail: `Import a bookmark JSON file or your browser bookmarks, or export bookmarks, from the ⋯ menu on the Bookmarks toolbar of the ${PROJECT.name} page. When duplicates are found, choose skip or allow for that import; title updates are also scoped to that dialog.`,
			href: 'newtab.html#bookmark-library',
			action: 'Open bookmarks',
		},
		{
			icon: MousePointerClick,
			title: 'Right-click menus',
			text: `Right-click a link to bookmark it to a column, or save it for later in the “Saved links” session without opening it. Right-click a page to bookmark it, or to save this tab, this window, its tab group, or the tabs to its left or right. Select text and right-click to search your saved tabs and bookmarks for it. Right-click the ${PROJECT.name} toolbar icon to open the dashboard, save this window, exclude the current site from saves, or open Help and Settings.`,
			detail: `Each menu groups its actions under one ${PROJECT.name} item, and the toolbar icon briefly shows ✓ when an action is done. Browsers don’t let extensions add items to the tab strip’s right-click menu. Choose which menus appear in Settings › Right-click menus.`,
		},
		{
			icon: Settings2,
			title: 'Settings',
			text: `Set startup behavior, whether to open ${PROJECT.name} after saving, restore destination and duplicate policy, default session sorting, URL display, title-click behavior, local copy format, which right-click menus appear, site exclusions, and optional background-tab unloading. ${PROJECT.name} follows the system color theme by default.`,
			href: 'options.html',
			action: 'Open settings',
		},
		{
			icon: Database,
			title: 'Local data and backups',
			text: `${PROJECT.name} stores sessions, bookmarks, and preferences in this browser’s extension storage. It does not use accounts, servers, or cloud sync. Exported JSON and HTML files are plain text; keep them private if their URLs, titles, or notes are sensitive.`,
			detail:
				'Session import and export are in the Sessions ⋯ menu; bookmark import and export are in the Bookmarks toolbar ⋯ menu. Settings › Data can also export bookmarks, and can permanently erase all sessions, all bookmarks, or everything; settings and excluded sites are kept.',
		},
		{
			icon: Keyboard,
			title: 'Keyboard shortcuts',
			text: `Review or change ${PROJECT.name} shortcuts in the browser’s extension-shortcuts page. Browser support for tab groups, pinned tabs, startup behavior, and unloading depends on Chromium APIs and browser policy.`,
			href: SHORTCUTS_URL,
			action: 'Configure shortcuts',
		},
	];
	const projectLinks = [
		{icon: Globe, label: 'Website', href: PROJECT.websiteUrl},
		{icon: Github, label: 'Source code', href: PROJECT.repoUrl},
		{icon: Bug, label: 'Report an issue', href: PROJECT.issuesUrl},
		{icon: Tag, label: 'Releases and changelog', href: PROJECT.changelogUrl},
		{
			icon: Scale,
			label: `${PROJECT.license} License`,
			href: PROJECT.licenseUrl,
		},
	];
	return (
		<main
			data-brand="tablodge"
			className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-9"
		>
			<AppHeader active="help" />
			<div className="space-y-3">
				{sections.map(({icon: Icon, title, text, detail, href, action}) => (
					<Card key={title}>
						<CardHeader className="flex-row items-center gap-3 space-y-0 pb-2">
							<span className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
								<Icon className="h-4 w-4" />
							</span>
							<CardTitle>{title}</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm leading-6 text-muted-foreground">{text}</p>
							{detail && <p className="mt-2 text-sm font-medium">{detail}</p>}
							{href === SHORTCUTS_URL && (
								<>
									<Button
										className="mt-4"
										variant="outline"
										onClick={async () => {
											setShortcutsFailed(!(await openShortcutsPage()));
										}}
									>
										{action}
										<ArrowUpRight className="h-4 w-4" />
									</Button>
									{shortcutsFailed && (
										<p
											role="alert"
											className="mt-2 text-xs text-muted-foreground"
										>
											Your browser did not open it. Paste{' '}
											<code>{SHORTCUTS_URL}</code> into the address bar.
										</p>
									)}
								</>
							)}
							{href && href !== SHORTCUTS_URL && (
								<Button asChild className="mt-4">
									<a href={href}>
										{href === 'options.html' ? (
											<>
												<Settings2 className="h-4 w-4" />
												{action}
											</>
										) : (
											action
										)}
									</a>
								</Button>
							)}
						</CardContent>
					</Card>
				))}
				<Card id="about">
					<CardHeader className="flex-row items-center gap-3 space-y-0 pb-2">
						<span className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
							<Info className="h-4 w-4" />
						</span>
						<CardTitle>About {PROJECT.name}</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-sm leading-6 text-muted-foreground">
							{PROJECT.name} is free and open-source software under the{' '}
							{PROJECT.license} License. Report bugs and suggest features on
							GitHub.
						</p>
						<p className="mt-2 text-sm font-medium">
							Version {PROJECT.version}
						</p>
						<div className="mt-4 flex flex-wrap gap-2">
							{projectLinks.map(({icon: Icon, label, href}) => (
								<Button key={label} asChild variant="outline" size="sm">
									<a href={href} target="_blank" rel="noopener noreferrer">
										<Icon className="h-4 w-4" />
										{label}
										<ArrowUpRight className="h-4 w-4" />
									</a>
								</Button>
							))}
						</div>
					</CardContent>
				</Card>
			</div>
		</main>
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<TooltipProvider>
			<Help />
		</TooltipProvider>
	</ThemeProvider>,
);
