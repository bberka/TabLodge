// The small notice a source save or a saved page catch-up shows in the site's page. It sits in a closed shadow root
// and sets every style through the element style object (as palette-overlay.ts does), so the page's CSS and its
// Content Security Policy and Trusted Types rules cannot reach in. It never takes focus: Tab reaches its buttons at
// the end of the page.
// It stays while the pointer or focus is on it, and Escape closes it from there. Closing it while it has focus
// returns focus to where it came from, never to the page body.
// It looks like the toast on TabLodge's own pages (StatusRegion in common.tsx): the theme and accent chosen in
// Settings, with the stylesheet's tokens, which a shadow root on another site cannot read, copied into TOAST_TOKENS.
import {
	DEFAULT_ACCENT,
	isAccent,
	legibleOn,
	presetColor,
	type Rgb,
	SYSTEM_ACCENT,
} from '../shared/accent-colors';
import {resolvePrivateAccent, systemAccentColor} from '../shared/accents';
import {isRecord} from '../shared/library-values';

const HOST_ID = 'tablodge-source-toast';
const VISIBLE_MS = 8000;
// A toast that asks something stays longer, so there is time to read it and decide.
const ASKING_VISIBLE_MS = 20_000;
const SVG = 'http://www.w3.org/2000/svg';

type Theme = 'light' | 'dark';
/**
What a button does. It answers with the toast's next text (the button then reads Close), with a next step whose
own button replaces the toast's buttons (Add them, then Undo), or with nothing, which closes the toast.
*/
export type ToastAction = {
	label: string;
	run: () => Promise<string | ToastStep | undefined>;
};
type ToastStep = {text: string; action?: ToastAction};

/**
The values of styles/extension-app.css this toast uses, as `r g b` like the stylesheet writes them
(tests/site-sources.test.ts keeps them equal). `primary` is the default indigo accent.
*/
export const TOAST_TOKENS = {
	light: {
		popover: '255 255 255',
		popoverForeground: '24 24 27',
		border: '228 228 231',
		destructive: '220 38 38',
		primary: '98 84 215',
	},
	dark: {
		popover: '17 17 20',
		popoverForeground: '250 250 250',
		border: '39 39 42',
		destructive: '248 113 113',
		primary: '165 155 255',
	},
	// In px: rem would follow the site's root font size, not the extension's 16px.
	radius: '8px',
} as const;

// Lucide's circle-check and circle-alert, the icons the extension's own toast shows.
const ICONS: Record<
	'done' | 'error',
	Array<[string, Record<string, string>]>
> = {
	done: [
		['circle', {cx: '12', cy: '12', r: '10'}],
		['path', {d: 'm16 9-5.5 5.5L8 12'}],
	],
	error: [
		['circle', {cx: '12', cy: '12', r: '10'}],
		[
			'line',
			{
				x1: '12',
				x2: '12',
				y1: '8',
				y2: '12',
			},
		],
		[
			'line',
			{
				x1: '12',
				x2: '12.01',
				y1: '16',
				y2: '16',
			},
		],
	],
};

const PRIVATE_CONFIG_KEY = 'tablodge.private.config';

/**
The theme and accent the extension's pages show, from what they keep in storage. Anything unexpected counts as the
default, as on those pages. A private window uses its own accent, as its pages do.
*/
export function toastAppearance(
	stored: Record<string, unknown>,
	{systemDark, incognito}: {systemDark: boolean; incognito: boolean},
): {theme: Theme; accent: string} {
	const theme =
		stored.uiTheme === 'light' || stored.uiTheme === 'dark'
			? stored.uiTheme
			: systemDark
				? 'dark'
				: 'light';
	const accent = isAccent(stored.uiAccent) ? stored.uiAccent : DEFAULT_ACCENT;
	const config = stored[PRIVATE_CONFIG_KEY];
	// With no private accent stored, a private window shows the private default, as its pages do.
	const privateAccent = incognito
		? resolvePrivateAccent(isRecord(config) ? config.accent : undefined)
		: undefined;
	return {theme, accent: privateAccent ?? accent};
}

const rgb = (channels: string, alpha = 1) =>
	`rgb(${channels}${alpha < 1 ? ` / ${alpha}` : ''})`;

/**
The colors of the toast for a theme and an accent color (undefined: the default indigo). The accent is darkened or
lightened until it reads, like `applyAccent` does, but against the toast's own background, where Undo sits.
*/
export function toastColors(theme: Theme, accent: Rgb | undefined) {
	const tokens = TOAST_TOKENS[theme];
	const background = tokens.popover.split(' ').map(Number) as Rgb;
	const primary = accent
		? legibleOn(accent, background).join(' ')
		: tokens.primary;
	return {
		background: rgb(tokens.popover),
		text: rgb(tokens.popoverForeground),
		border: rgb(tokens.border),
		errorBorder: rgb(tokens.destructive, 0.4),
		destructive: rgb(tokens.destructive),
		primary: rgb(primary),
	};
}

async function readAppearance() {
	const os = {
		systemDark:
			globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
		incognito: chrome.extension?.inIncognitoContext,
	};
	// A script left behind by an extension update or removal can no longer read storage; it then uses the defaults.
	try {
		const stored = await chrome.storage.local.get([
			'uiTheme',
			'uiAccent',
			PRIVATE_CONFIG_KEY,
		]);
		return toastAppearance(stored, os);
	} catch {
		return toastAppearance({}, os);
	}
}

function set(element: HTMLElement | SVGElement, rules: Record<string, string>) {
	for (const [name, value] of Object.entries(rules)) {
		element.style.setProperty(name, value, 'important');
	}
}

function icon(kind: 'done' | 'error', color: string) {
	const svg = document.createElementNS(SVG, 'svg');
	for (const [name, value] of Object.entries({
		viewBox: '0 0 24 24',
		fill: 'none',
		stroke: color,
		'stroke-width': '2',
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
		'aria-hidden': 'true',
	})) {
		svg.setAttribute(name, value);
	}

	set(svg, {
		flex: '0 0 auto',
		width: '16px',
		height: '16px',
		'margin-top': '2px',
	});
	for (const [tag, attributes] of ICONS[kind]) {
		const shape = document.createElementNS(SVG, tag);
		for (const [name, value] of Object.entries(attributes)) {
			shape.setAttribute(name, value);
		}

		svg.append(shape);
	}

	return svg;
}

let latestToast = 0;
let closeShown: (() => void) | undefined;

/**
Shows the notice. `error` marks a save that failed, in the destructive color, as the extension's error toasts are.
`actions` are its buttons; with two or more the toast asks something and stays longer.
*/
export function showSourceToast(
	text: string,
	{
		actions = [],
		error = false,
	}: {actions?: readonly ToastAction[]; error?: boolean} = {},
) {
	// The one on screen goes now, so its buttons can't act while the new one reads the theme. That read is async, so
	// a later notice could also be replaced by an earlier one; only the newest renders.
	closeShown?.();
	const request = ++latestToast;
	void readAppearance().then(({theme, accent}) => {
		if (request !== latestToast) {
			return;
		}

		render(text, {
			actions,
			error,
			theme,
			accent,
		});
	});
}

function render(
	text: string,
	{
		actions,
		error,
		theme,
		accent,
	}: {
		actions: readonly ToastAction[];
		error: boolean;
		theme: Theme;
		accent: string;
	},
) {
	// One left by an earlier copy of this script, after an extension update, is not in closeShown.
	document.querySelector(`#${HOST_ID}`)?.remove();
	const host = document.createElement('div');
	host.id = HOST_ID;
	set(host, {
		all: 'initial',
		position: 'fixed',
		right: '16px',
		bottom: '16px',
		'z-index': '2147483647',
		display: 'block',
		'max-width': 'min(448px, calc(100vw - 32px))',
		'color-scheme': theme,
	});
	const root = host.attachShadow({mode: 'closed'});
	document.documentElement.append(host);
	const colors = toastColors(
		theme,
		accent === SYSTEM_ACCENT ? systemAccentColor(root) : presetColor(accent),
	);

	const box = document.createElement('div');
	set(box, {
		display: 'flex',
		'align-items': 'flex-start',
		gap: '10px',
		padding: '10px 8px 10px 12px',
		'border-radius': TOAST_TOKENS.radius,
		border: `1px solid ${error ? colors.errorBorder : colors.border}`,
		background: colors.background,
		color: colors.text,
		'box-shadow':
			'0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
		font: '400 14px/20px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
		'-webkit-font-smoothing': 'antialiased',
		'text-align': 'left',
		'letter-spacing': 'normal',
	});
	box.append(
		icon(error ? 'error' : 'done', error ? colors.destructive : colors.primary),
	);
	// The region exists before its text, so screen readers announce the text when it arrives.
	const message = document.createElement('span');
	message.setAttribute('role', 'status');
	set(message, {
		flex: '1 1 auto',
		'min-width': '0',
		'overflow-wrap': 'anywhere',
	});
	box.append(message);

	const visibleMs = actions.length > 1 ? ASKING_VISIBLE_MS : VISIBLE_MS;
	const makeButton = (label: string) => {
		const target = document.createElement('button');
		target.type = 'button';
		target.textContent = label;
		set(target, {
			flex: '0 0 auto',
			'min-height': '24px',
			margin: '-2px 0',
			padding: '0 6px',
			border: '0',
			'border-radius': '4px',
			background: 'transparent',
			color: colors.primary,
			font: 'inherit',
			'font-weight': '600',
			'text-decoration': 'none',
			'text-underline-offset': '4px',
			outline: '2px solid transparent',
			'outline-offset': '0',
			cursor: 'pointer',
		});
		// The ring shows for keyboard focus only, as on the extension's pages.
		target.addEventListener('focus', () => {
			if (target.matches(':focus-visible')) {
				// An outline, not a shadow, so forced-colors mode still shows it.
				set(target, {'outline-color': colors.primary});
			}
		});
		target.addEventListener('blur', () => {
			set(target, {'outline-color': 'transparent'});
		});
		target.addEventListener('pointerenter', () => {
			set(target, {'text-decoration': 'underline'});
		});
		target.addEventListener('pointerleave', () => {
			set(target, {'text-decoration': 'none'});
		});
		box.append(target);
		return target;
	};

	// Each button and what it does now; undefined once it reads Close.
	const buttons = new Map<HTMLButtonElement, ToastAction | undefined>();
	for (const action of actions) {
		buttons.set(makeButton(action.label), action);
	}

	root.append(box);
	requestAnimationFrame(() => {
		message.textContent = text;
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	let held = false;
	let previous: HTMLElement | undefined;
	let closed = false;
	// Runs once. A closed notice whose Undo finishes later must not arm a timer or unregister the notice now shown.
	const close = () => {
		if (closed) {
			return;
		}

		closed = true;
		if (closeShown === close) {
			closeShown = undefined;
		}

		clearTimeout(timer);
		const hadFocus = root.activeElement !== null;
		host.remove();
		if (hadFocus && previous?.isConnected) {
			previous.focus();
		}
	};

	closeShown = close;
	const schedule = () => {
		clearTimeout(timer);
		if (!held && !closed) {
			timer = setTimeout(close, visibleMs);
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
	// After an action the clicked button stays, as Close or as the next step's button, so focus stays on it rather
	// than falling to the page body.
	let busy = false;
	const press = async (target: HTMLButtonElement) => {
		if (busy) {
			return;
		}

		const action = buttons.get(target);
		if (!action) {
			close();
			return;
		}

		busy = true;
		for (const other of buttons.keys()) {
			other.setAttribute('aria-disabled', 'true');
		}

		const next = await action.run();
		busy = false;
		if (next === undefined) {
			close();
			return;
		}

		const step = typeof next === 'string' ? {text: next} : next;
		message.textContent = step.text;
		for (const other of buttons.keys()) {
			if (other === target) {
				continue;
			}

			// Tab may have moved to this button while the action ran; focus stays in the toast.
			if (root.activeElement === other) {
				target.focus();
			}

			other.remove();
			buttons.delete(other);
		}

		target.textContent = step.action?.label ?? 'Close';
		target.removeAttribute('aria-disabled');
		buttons.set(target, step.action);
		schedule();
	};

	for (const target of buttons.keys()) {
		target.addEventListener('click', async () => press(target));
	}

	schedule();
}
