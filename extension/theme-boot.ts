// Applies the saved theme and accent color before the first paint so extension pages never flash the
// wrong background or accent. src/shared/theme.tsx mirrors the chosen theme and accent (stored in
// chrome.storage) into this extension's localStorage. Every page loads the built theme-boot.js as a
// classic script in <head>.
import {applyAccent, readSavedAccent} from '../src/shared/accents';

(() => {
	try {
		const theme = localStorage.getItem('tablodge.uiTheme');
		if (theme !== null && ['light', 'dark', 'system'].includes(theme)) {
			document.documentElement.dataset.theme = theme;
		}
	} catch {
		/*
		Storage can be unavailable; the HTML default ("system") stays.
		*/
	}

	applyAccent(readSavedAccent());
})();
