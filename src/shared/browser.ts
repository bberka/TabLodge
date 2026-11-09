/**
The one place extension pages ask which browser they run in. TabLodge builds for Chromium and Firefox from the
same source (see "Browser support" in docs/architecture.md); a page branches here instead of testing the browser itself.
Anything a page can learn by looking for the API (`chrome.tabGroups`, `chrome.sidePanel`) should keep doing that.
*/

/**
Firefox gives extension pages `moz-extension://` addresses; Chromium uses `chrome-extension://`.
*/
export const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension:');

type SidebarApi = {open?: () => Promise<void>};
const sidebar = (): SidebarApi | undefined =>
	(chrome as typeof chrome & {sidebarAction?: SidebarApi}).sidebarAction;

/**
Chromium opens its Side Panel from the toolbar button, a shortcut, or a menu. Firefox has a sidebar instead,
which a page can open from a click but which the toolbar button cannot be set to open.
*/
export const canOpenSidePanel =
	typeof chrome.sidePanel?.open === 'function' ||
	typeof sidebar()?.open === 'function';

/**
Whether the toolbar button can be set to open the side panel itself (Chromium only).
*/
export const toolbarOpensSidePanel =
	typeof chrome.sidePanel?.setPanelBehavior === 'function';

/**
Opens the side panel (Chromium) or sidebar (Firefox). Both only open from a user action, so call it from the
click handler before awaiting anything else. `windowId` is the window to open it in; Firefox always uses the current one.
*/
export async function openSidePanel(windowId: number | undefined) {
	if (typeof chrome.sidePanel?.open === 'function' && windowId !== undefined) {
		await chrome.sidePanel.open({windowId});
		return;
	}

	await sidebar()?.open?.();
}

/**
Where to change extension shortcuts, as text for the "your browser did not open it" hint.
*/
export const SHORTCUTS_HINT = isFirefox
	? 'Open the Add-ons Manager, click the gear icon, and choose Manage Extension Shortcuts.'
	: 'Paste chrome://extensions/shortcuts into the address bar.';

type CommandsApi = {openShortcutSettings?: () => Promise<void>};

/**
Opens the browser's extension-shortcuts page. Plain links to browser pages are blocked, so this goes through the API:
Firefox has `commands.openShortcutSettings`, Chromium takes `tabs.create`.
*/
export async function openShortcutsPage(): Promise<boolean> {
	try {
		const commands = chrome.commands as CommandsApi | undefined;
		if (isFirefox) {
			await commands?.openShortcutSettings?.();
			return typeof commands?.openShortcutSettings === 'function';
		}

		await chrome.tabs.create({url: 'chrome://extensions/shortcuts'});
		return true;
	} catch {
		return false;
	}
}
