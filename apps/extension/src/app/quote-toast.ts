// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the worker project has no DOM types, and this function runs in a page
/// <reference lib="dom" />
/**
The confirmation of a "Save quote" click, shown at the bottom of the page. The service worker passes this function to
chrome.scripting.executeScript under the activeTab grant of the menu click, so it runs in the page's isolated world, is
serialized as source, and must not use anything declared outside it (no imports, no helpers).

It sits in a closed shadow root with every style set on the element, like the palette overlay, so the page's CSS cannot
reach it. It never takes focus: the message is announced through a status region, and Undo is a normal button that Tab
reaches. Undo sends QUOTE_UNDO with `undoId`, which the worker accepts only from the tab it showed this toast in. The toast closes on its own, but not while the pointer or focus
is on it, and Escape closes it while it has focus.
*/
export function showQuoteToast(toast: {
	message: string;
	failed: boolean;
	undoId?: string;
	theme: 'system' | 'light' | 'dark';
	/**
	The edges to sit at (from `toastEdges`, as the worker cannot pass this function an import) and how long to stay,
	null for never.
	*/
	edges: {
		top?: string;
		bottom?: string;
		left?: string;
		right?: string;
		transform?: string;
	};
	closeMs: number | null;
}): boolean {
	const hostId = 'tablodge-quote-toast';
	document.querySelector(`#${hostId}`)?.remove();

	const dark =
		toast.theme === 'dark' ||
		(toast.theme === 'system' &&
			globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
	const colors = dark
		? {
				surface: '#1d2130',
				text: '#eef0f6',
				border: '#353b4f',
				accent: '#a8a2ff',
				danger: '#ff9b9b',
			}
		: {
				surface: '#ffffff',
				text: '#222737',
				border: '#dde1ea',
				accent: '#4f46c8',
				danger: '#b91c1c',
			};
	const set = (element: HTMLElement, rules: Record<string, string>) => {
		for (const [name, value] of Object.entries(rules)) {
			element.style.setProperty(name, value, 'important');
		}
	};

	const host = document.createElement('div');
	host.id = hostId;
	set(host, {
		all: 'initial',
		position: 'fixed',
		top: toast.edges.top ?? 'auto',
		bottom: toast.edges.bottom ?? 'auto',
		left: toast.edges.left ?? 'auto',
		right: toast.edges.right ?? 'auto',
		transform: toast.edges.transform ?? 'none',
		'z-index': '2147483647',
		'max-width': 'calc(100vw - 32px)',
	});
	const root = host.attachShadow({mode: 'closed'});
	const box = document.createElement('div');
	set(box, {
		display: 'flex',
		'align-items': 'center',
		gap: '12px',
		padding: '10px 12px 10px 16px',
		'border-radius': '10px',
		border: `1px solid ${colors.border}`,
		background: colors.surface,
		color: colors.text,
		'box-shadow': '0 8px 28px rgba(0, 0, 0, 0.25)',
		font: '14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
		'color-scheme': dark ? 'dark' : 'light',
	});
	const text = document.createElement('span');
	text.setAttribute('role', toast.failed ? 'alert' : 'status');
	set(text, {
		color: toast.failed ? colors.danger : colors.text,
		'overflow-wrap': 'anywhere',
	});
	box.append(text);

	let timer: ReturnType<typeof setTimeout> | undefined;
	const close = () => {
		clearTimeout(timer);
		host.remove();
	};

	const later = () => {
		clearTimeout(timer);
		if (toast.closeMs !== null) {
			timer = setTimeout(close, toast.closeMs);
		}
	};

	if (toast.undoId) {
		const {undoId} = toast;
		const undo = document.createElement('button');
		undo.type = 'button';
		undo.textContent = 'Undo';
		set(undo, {
			all: 'initial',
			cursor: 'pointer',
			padding: '4px 10px',
			'border-radius': '6px',
			color: colors.accent,
			font: '600 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
		});
		undo.addEventListener('focus', () => {
			undo.style.setProperty(
				'outline',
				`2px solid ${colors.accent}`,
				'important',
			);
		});
		undo.addEventListener('blur', () => {
			undo.style.removeProperty('outline');
		});
		undo.addEventListener('click', () => {
			undo.remove();
			void chrome.runtime
				.sendMessage({type: 'QUOTE_UNDO', id: undoId})
				.then((result: {ok?: boolean; error?: string} | undefined) => {
					text.textContent = result?.ok
						? 'Quote removed.'
						: (result?.error ?? 'Could not undo.');
				})
				.catch(() => {
					text.textContent = 'Could not undo.';
				})
				.finally(later);
		});
		box.append(undo);
	}

	box.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			close();
		}
	});
	box.addEventListener('pointerenter', () => {
		clearTimeout(timer);
	});
	box.addEventListener('pointerleave', later);
	box.addEventListener('focusin', () => {
		clearTimeout(timer);
	});
	box.addEventListener('focusout', later);

	root.append(box);
	(document.body ?? document.documentElement).append(host);
	// A live region announces text that changes after it is on the page, so the message goes in a moment later.
	setTimeout(() => {
		text.textContent = toast.message;
	}, 50);
	later();
	return true;
}
