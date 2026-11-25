import {useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import {TooltipProvider} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider, useTheme} from '../shared/theme';
import {webUrl} from '../shared/web-url';
import {PrivateLockGate} from './private-lock-ui';
import {LoadingLine, send, useTabLodgeState} from './common';
import {FinderPaletteWindow} from './finder';
import {
	finderActions,
	type CommandHandlers,
	type PageCommandId,
} from './finder-commands';
import {syncNowOutcome} from './sync-now';
import {keptCopyMessage} from './page-copies';
import {inPrivateWindow} from './private-config';
import {paletteOverlay, paletteTabId, paletteWindowId} from './page-params';

function PalettePage() {
	const windowId = paletteWindowId(location.search);
	const tabId = paletteTabId(location.search);
	const overlay = paletteOverlay(location.search);
	const {state, error} = useTabLodgeState();
	const {setTheme} = useTheme();
	const actions = useMemo(() => {
		const open = async (path: string) => {
			await chrome.tabs.create({windowId, url: chrome.runtime.getURL(path)});
			if (windowId !== undefined) {
				await chrome.windows.update(windowId, {focused: true});
			}
		};

		const onDashboard = (id: PageCommandId) => async () =>
			open(`newtab.html?command=${id}`);
		const handlers: CommandHandlers = {
			async 'save-window'() {
				const result = await send('SAVE_TABS', {scope: 'window'});
				if (!result?.ok) {
					throw new Error(result?.error || 'Could not save this window.');
				}
			},
			'keep-copy': inPrivateWindow()
				? undefined
				: async () => {
						const [tab] =
							windowId === undefined
								? []
								: await chrome.tabs.query({active: true, windowId});
						if (tab?.id === undefined || !webUrl(tab.url)) {
							throw new Error('Open a regular web page to keep a copy of it.');
						}

						const result = await send('KEEP_PAGE_COPY', {tabId: tab.id});
						if (!result.ok) {
							throw new Error(keptCopyMessage(result));
						}
					},
			'new-bookmark': onDashboard('new-bookmark'),
			'new-column': onDashboard('new-column'),
			'new-folder': onDashboard('new-folder'),
			'sync-now': inPrivateWindow()
				? undefined
				: async () => {
						const {message, failed} = syncNowOutcome(await send('SYNC_NOW'));
						if (failed) {
							throw new Error(message);
						}
					},
			async 'back-up-now'() {
				const result = await send('BACKUP_NOW');
				if (!result.ok) {
					throw new Error(result.error);
				}
			},
			'open-trash': onDashboard('open-trash'),
			'share-bookmarks': onDashboard('share-bookmarks'),
			'import-bookmarks': onDashboard('import-bookmarks'),
			'shared-pages': onDashboard('shared-pages'),
			'backup-bookmarks': onDashboard('backup-bookmarks'),
			'import-sessions': onDashboard('import-sessions'),
			'backup-sessions': onDashboard('backup-sessions'),
			'recent-snapshots': inPrivateWindow()
				? undefined
				: onDashboard('recent-snapshots'),
			'lock-private': inPrivateWindow()
				? async () => {
						const result = await send('LOCK_PRIVATE');
						if (!result.ok) {
							throw new Error(result.error);
						}

						if (!result.enabled) {
							throw new Error(
								'The private library has no password to lock it with.',
							);
						}
					}
				: undefined,
			'toggle-theme'() {
				const dark = document.documentElement.style.colorScheme === 'dark';
				void setTheme(dark ? 'light' : 'dark');
			},
			'open-dashboard': async () => open('newtab.html'),
		};
		return finderActions(handlers, open);
	}, [windowId, setTheme]);

	if (!state) {
		return error ? (
			<p role="alert" className="p-5 text-sm text-destructive">
				{error}
			</p>
		) : (
			<main className="min-h-screen p-5" aria-busy="true">
				<LoadingLine />
			</main>
		);
	}

	return (
		<FinderPaletteWindow
			state={state}
			actions={actions}
			windowId={windowId}
			tabId={tabId}
			overlay={overlay}
		/>
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<TooltipProvider>
			<PrivateLockGate>
				<PalettePage />
			</PrivateLockGate>
		</TooltipProvider>
	</ThemeProvider>,
);
