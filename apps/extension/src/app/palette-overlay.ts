// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the worker project has no DOM types, and this function runs in a page
/// <reference lib="dom" />
/**
Shows or hides the search palette over a web page. The service worker passes this function to
chrome.scripting.executeScript when the shortcut is pressed with the "In the current page" setting, so it runs in
the page, is serialized as source, and must not use anything declared outside it (no imports, no helpers).

The palette itself is palette.html in a frame, so it keeps its own styles, scripts and keyboard handling. The
frame sits in a closed shadow root and every style is set through the element's style object, so the page's CSS and
its Content Security Policy cannot reach in, and nothing leaks out. The frame tells this script to close with a
`tablodge-palette-close` message; Escape on the page, a click outside the palette and a second shortcut press close
it too. Focus returns to the element that had it before.
*/
export function togglePaletteOverlay(frameUrl: string): boolean {
	const hostId = 'tablodge-palette-overlay';
	const existing = document.querySelector(`#${hostId}`);
	if (existing) {
		existing.dispatchEvent(new CustomEvent('tablodge-palette-close'));
		return true;
	}

	const previous = document.activeElement as HTMLElement | null;
	const host = document.createElement('div');
	host.id = hostId;
	const set = (element: HTMLElement, rules: Record<string, string>) => {
		for (const [name, value] of Object.entries(rules)) {
			element.style.setProperty(name, value, 'important');
		}
	};

	set(host, {
		all: 'initial',
		position: 'fixed',
		inset: '0',
		'z-index': '2147483647',
		display: 'block',
	});
	const root = host.attachShadow({mode: 'closed'});
	const backdrop = document.createElement('div');
	set(backdrop, {
		position: 'fixed',
		inset: '0',
		background: 'rgba(0, 0, 0, 0.4)',
	});
	const dialog = document.createElement('div');
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-label', 'Search TabLodge');
	set(dialog, {
		position: 'fixed',
		top: '14vh',
		left: '50%',
		transform: 'translateX(-50%)',
		width: 'min(640px, calc(100vw - 32px))',
		height: 'min(520px, 80vh)',
		overflow: 'hidden',
		'border-radius': '12px',
		'box-shadow': '0 20px 60px rgba(0, 0, 0, 0.45)',
	});
	const frame = document.createElement('iframe');
	frame.title = 'Search TabLodge';
	frame.src = frameUrl;
	set(frame, {
		display: 'block',
		width: '100%',
		height: '100%',
		border: '0',
		margin: '0',
		'color-scheme': 'normal',
	});
	dialog.append(frame);
	root.append(backdrop, dialog);

	const frameOrigin = new URL(frameUrl).origin;
	function close() {
		globalThis.removeEventListener('message', onMessage);
		document.removeEventListener('keydown', onKeyDown, true);
		document.removeEventListener('focusin', onFocusIn, true);
		host.remove();
		if (previous?.isConnected) {
			previous.focus({preventScroll: true});
		}
	}

	function onMessage(event: MessageEvent) {
		if (
			event.source === frame.contentWindow &&
			event.origin === frameOrigin &&
			(event.data as {type?: string} | null)?.type === 'tablodge-palette-close'
		) {
			close();
		}
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Escape') {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		close();
	}

	// Focus stays in the palette while it is open: anything the page focuses behind it goes back to the frame.
	function onFocusIn(event: FocusEvent) {
		if (event.target !== host) {
			frame.focus();
		}
	}

	host.addEventListener('tablodge-palette-close', close);
	backdrop.addEventListener('mousedown', (event) => {
		event.preventDefault();
		close();
	});
	frame.addEventListener('load', () => {
		frame.focus();
	});
	globalThis.addEventListener('message', onMessage);
	document.addEventListener('keydown', onKeyDown, {capture: true});
	document.addEventListener('focusin', onFocusIn, {capture: true});
	document.documentElement.append(host);
	frame.focus();
	return true;
}
