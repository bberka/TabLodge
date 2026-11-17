// The small notice a source save shows in the site's page. It sits in a closed shadow root and sets every style
// through the element style object (as palette-overlay.ts does), so the page's CSS and its Content Security Policy
// and Trusted Types rules cannot reach in. It never takes focus: Tab reaches its Undo button at the end of the page.
// It stays while the pointer or focus is on it, and Escape closes it from there. Closing it while it has focus
// returns focus to where it came from, never to the page body.

const HOST_ID = 'tablodge-source-toast';
const VISIBLE_MS = 8000;

type ToastAction = {label: string; run: () => Promise<string>};

function set(element: HTMLElement, rules: Record<string, string>) {
	for (const [name, value] of Object.entries(rules)) {
		element.style.setProperty(name, value, 'important');
	}
}

export function showSourceToast(text: string, action?: ToastAction) {
	document.querySelector(`#${HOST_ID}`)?.remove();
	const dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
	const host = document.createElement('div');
	host.id = HOST_ID;
	set(host, {
		all: 'initial',
		position: 'fixed',
		right: '16px',
		bottom: '16px',
		'z-index': '2147483647',
		display: 'block',
		'max-width': 'min(360px, calc(100vw - 32px))',
	});
	const root = host.attachShadow({mode: 'closed'});
	const box = document.createElement('div');
	set(box, {
		display: 'flex',
		'align-items': 'center',
		gap: '12px',
		padding: '10px 12px 10px 14px',
		'border-radius': '10px',
		border: `1px solid ${dark ? '#3f3f46' : '#d4d4d8'}`,
		background: dark ? '#18181b' : '#ffffff',
		color: dark ? '#fafafa' : '#18181b',
		'box-shadow': '0 8px 24px rgba(0, 0, 0, 0.25)',
		font: '14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
	});
	// The region exists before its text, so screen readers announce the text when it arrives.
	const message = document.createElement('span');
	message.setAttribute('role', 'status');
	set(message, {flex: '1 1 auto'});
	box.append(message);

	let button: HTMLButtonElement | undefined;
	if (action) {
		button = document.createElement('button');
		button.type = 'button';
		button.textContent = action.label;
		const accent = dark ? '#5eead4' : '#0f766e';
		set(button, {
			flex: '0 0 auto',
			'min-height': '28px',
			padding: '4px 10px',
			border: `1px solid ${accent}`,
			'border-radius': '6px',
			background: 'transparent',
			color: accent,
			font: 'inherit',
			'font-weight': '600',
			cursor: 'pointer',
		});
		button.addEventListener('focus', () => {
			set(button!, {outline: `2px solid ${accent}`, 'outline-offset': '2px'});
		});
		button.addEventListener('blur', () => {
			button!.style.removeProperty('outline');
		});
		box.append(button);
	}

	root.append(box);
	document.documentElement.append(host);
	requestAnimationFrame(() => {
		message.textContent = text;
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	let held = false;
	let previous: HTMLElement | undefined;
	let undone = false;
	const close = () => {
		clearTimeout(timer);
		const hadFocus = root.activeElement !== null;
		host.remove();
		if (hadFocus && previous?.isConnected) {
			previous.focus();
		}
	};

	const schedule = () => {
		clearTimeout(timer);
		if (!held) {
			timer = setTimeout(close, VISIBLE_MS);
		}
	};

	const hold = (value: boolean) => {
		held = value;
		schedule();
	};

	box.addEventListener('pointerenter', () => hold(true));
	box.addEventListener('pointerleave', () => hold(false));
	box.addEventListener('focusin', (event) => {
		if (
			event.relatedTarget instanceof HTMLElement &&
			event.relatedTarget !== host
		) {
			previous = event.relatedTarget;
		}

		hold(true);
	});
	box.addEventListener('focusout', () => hold(false));
	box.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			close();
		}
	});
	// After the action the button becomes Close, so focus stays on it rather than falling to the page body.
	button?.addEventListener('click', async () => {
		if (!action || !button || button.getAttribute('aria-disabled') === 'true') {
			return;
		}

		if (undone) {
			close();
			return;
		}

		undone = true;
		button.setAttribute('aria-disabled', 'true');
		message.textContent = await action.run();
		button.textContent = 'Close';
		button.removeAttribute('aria-disabled');
		schedule();
	});
	schedule();
}
