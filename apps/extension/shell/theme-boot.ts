import {applyAccent, readEffectiveAccent} from '../src/shared/accents';

(() => {
	try {
		const theme = localStorage.getItem('tablodge.uiTheme');
		if (theme !== null && ['light', 'dark', 'system'].includes(theme)) {
			document.documentElement.dataset.theme = theme;
		}
	} catch {}

	applyAccent(readEffectiveAccent());
})();
