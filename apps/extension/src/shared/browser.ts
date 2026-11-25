export const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension:');

type SidebarApi = {open?: () => Promise<void>};
const sidebar = (): SidebarApi | undefined =>
	(chrome as typeof chrome & {sidebarAction?: SidebarApi}).sidebarAction;

export const canOpenSidePanel =
	typeof chrome.sidePanel?.open === 'function' ||
	typeof sidebar()?.open === 'function';

export const toolbarOpensSidePanel =
	typeof chrome.sidePanel?.setPanelBehavior === 'function';

export async function openSidePanel(windowId: number | undefined) {
	if (typeof chrome.sidePanel?.open === 'function' && windowId !== undefined) {
		await chrome.sidePanel.open({windowId});
		return;
	}

	await sidebar()?.open?.();
}

export const SHORTCUTS_HINT = isFirefox
	? 'Open the Add-ons Manager, click the gear icon, and choose Manage Extension Shortcuts.'
	: 'Paste chrome://extensions/shortcuts into the address bar.';

type CommandsApi = {openShortcutSettings?: () => Promise<void>};

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
