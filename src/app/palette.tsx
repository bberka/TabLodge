import {useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import {Home, LifeBuoy, Save, Settings2, SunMoon} from 'lucide-react';
import {TooltipProvider} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider, useTheme} from '../shared/theme';
import {LoadingLine, send, useTabLodgeState} from './common';
import {FinderPaletteWindow, type FinderAction} from './finder';
import {paletteWindowId} from './page-params';

// The small window the service worker opens for the "Open the search palette" shortcut. It works on every page,
// restricted ones included, because it is a window of its own and not part of the page. `window` in the address
// is the browser window that was in front; links, searches and restores go there.
function PalettePage() {
	const windowId = paletteWindowId(location.search);
	const {state, error} = useTabLodgeState();
	const {setTheme} = useTheme();
	const actions = useMemo<FinderAction[]>(() => {
		const open = async (path: string) => {
			await chrome.tabs.create({windowId, url: chrome.runtime.getURL(path)});
			if (windowId !== undefined) {
				await chrome.windows.update(windowId, {focused: true});
			}
		};

		return [
			{
				id: 'save-window',
				title: 'Save this window',
				keywords: ['session', 'tabs', 'store'],
				icon: Save,
				async run() {
					const result = await send('SAVE_TABS', {scope: 'window'});
					if (!result?.ok) {
						throw new Error(result?.error || 'Could not save this window.');
					}
				},
			},
			{
				id: 'open-dashboard',
				title: 'Open dashboard',
				keywords: ['home', 'new tab', 'sessions', 'bookmarks'],
				icon: Home,
				run: async () => open('newtab.html'),
			},
			{
				id: 'toggle-theme',
				title: 'Toggle light/dark theme',
				keywords: ['appearance', 'dark mode', 'light mode'],
				icon: SunMoon,
				run() {
					const dark = document.documentElement.style.colorScheme === 'dark';
					void setTheme(dark ? 'light' : 'dark');
				},
			},
			{
				id: 'open-settings',
				title: 'Open Settings',
				keywords: ['preferences', 'options', 'shortcuts'],
				icon: Settings2,
				run: async () => open('options.html'),
			},
			{
				id: 'open-help',
				title: 'Open Help',
				keywords: ['guide', 'docs', 'manual'],
				icon: LifeBuoy,
				run: async () => open('help.html'),
			},
		];
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
		<FinderPaletteWindow state={state} actions={actions} windowId={windowId} />
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<TooltipProvider>
			<PalettePage />
		</TooltipProvider>
	</ThemeProvider>,
);
