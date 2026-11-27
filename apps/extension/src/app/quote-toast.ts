// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the worker project has no DOM types, and this function runs in a page
/// <reference lib="dom" />
export function showQuoteToast(toast: {
	message: string;
	failed: boolean;
	undo?: {
		type: 'QUOTE_UNDO' | 'TRASH_UNDO';
		id: string;
		done: string;
		expiresMs?: number;
	};
	theme: 'system' | 'light' | 'dark';
	edges: {
		top?: string;
		bottom?: string;
		left?: string;
		right?: string;
		transform?: string;
	};
	closeMs?: number;
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
	let expiry: ReturnType<typeof setTimeout> | undefined;
	const close = () => {
		clearTimeout(timer);
		clearTimeout(expiry);
		host.remove();
	};

	const later = () => {
		clearTimeout(timer);
		if (toast.closeMs !== undefined) {
			timer = setTimeout(close, toast.closeMs);
		}
	};

	const button = (label: string) => {
		const element = document.createElement('button');
		element.type = 'button';
		element.textContent = label;
		set(element, {
			all: 'initial',
			cursor: 'pointer',
			padding: '4px 10px',
			'border-radius': '6px',
			color: colors.accent,
			font: '600 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
		});
		element.addEventListener('focus', () => {
			element.style.setProperty(
				'outline',
				`2px solid ${colors.accent}`,
				'important',
			);
		});
		element.addEventListener('blur', () => {
			element.style.removeProperty('outline');
		});
		return element;
	};

	if (toast.undo) {
		const {undo} = toast;
		const undoButton = button('Undo');
		undoButton.addEventListener('click', () => {
			clearTimeout(expiry);
			undoButton.remove();
			void chrome.runtime
				.sendMessage({type: undo.type, id: undo.id})
				.then(
					(
						result:
							{ok?: boolean; error?: string; message?: string} | undefined,
					) => {
						text.textContent = result?.ok
							? (result.message ?? undo.done)
							: (result?.error ?? 'Could not undo.');
					},
				)
				.catch(() => {
					text.textContent = 'Could not undo.';
				})
				.finally(later);
		});
		box.append(undoButton);
	}

	if (toast.closeMs === undefined) {
		const closeButton = button('Close');
		closeButton.addEventListener('click', close);
		box.append(closeButton);
	}

	if (toast.undo?.expiresMs !== undefined) {
		expiry = setTimeout(() => {
			const [undoButton, closeButton] = box.querySelectorAll('button');
			if (root.activeElement === undoButton) {
				closeButton?.focus();
			}

			undoButton?.remove();
		}, toast.undo.expiresMs);
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
	setTimeout(() => {
		text.textContent = toast.message;
	}, 50);
	later();
	return true;
}
