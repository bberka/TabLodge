// The small notices a source save or a saved page catch-up shows in the site's page. They stack in one closed shadow root,
// newest nearest the corner, at most MAX_TOASTS (a 4th closes the oldest), each with its own timer and its own Undo.
// A notice that answers another is that notice's next text (see ToastAction), so it replaces it in place.
// Each sits in a closed shadow root
// and sets every style through the element style object (as palette-overlay.ts does), so the page's CSS and its
// Content Security Policy and Trusted Types rules cannot reach in. It never takes focus: Tab reaches its buttons at the end of the page.
// It stays while the pointer or focus is on it, and Escape closes it from there. Closing it while it has focus
// returns focus to where it came from, never to the page body.
// Its actions (Undo, Also save on the site, Add them, Not now) are buttons after the text; once one runs, the others
// go and it becomes Close, or the next step's button (Add them, then Undo), so focus stays on it.
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
import type {ActionResult} from '../shared/types';
import {isRecord} from '../shared/library-values';
import {
	toastEdges,
	toastMs,
	toastPlace,
	type ToastDuration,
	type ToastPosition,
} from '../shared/toast-prefs';

const HOST_ID = 'tablodge-source-toast';
const VISIBLE_MS = 8000;
const MAX_TOASTS = 3;
// Settings › Messages stay: Longer doubles these, Until dismissed never closes a notice by itself.
// A notice that asks something stays longer, so there is time to read it and decide.
const ASKING_VISIBLE_MS = 20_000;
const SVG = 'http://www.w3.org/2000/svg';

type Theme = 'light' | 'dark';
/**
What a button does. It answers with the notice's next text (the button then reads Close), with a next step whose own
button it becomes, or with nothing, which closes the notice.
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

type ToastPrefs = {position: ToastPosition; duration: ToastDuration};

/**
Where notices appear and how long they stay, as the worker keeps them in Settings: a site's page cannot read the
settings itself. Without an answer (a script left behind by an update, or a worker that is asleep) the defaults apply.
*/
async function readPrefs(): Promise<ToastPrefs> {
	try {
		const result = await chrome.runtime.sendMessage<
			{type: string},
			ActionResult<'TOAST_PREFS'> | undefined
		>({type: 'TOAST_PREFS'});
		if (result?.ok) {
			return {position: result.position, duration: result.duration};
		}
	} catch {
		// Not reachable: the default place and times.
	}

	return {position: 'default', duration: 'default'};
}

/**
Puts the stack at the chosen place: the bottom right of the page unless Settings says otherwise. The newest notice
sits nearest the edge, so a stack at the top lists them in reverse.
*/
function place(current: Stack, position: ToastPosition) {
	const edges = toastEdges(toastPlace(position, 'bottom-right'), 16);
	set(current.host, {
		top: edges.top ?? 'auto',
		bottom: edges.bottom ?? 'auto',
		left: edges.left ?? 'auto',
		right: edges.right ?? 'auto',
		transform: edges.transform ?? 'none',
	});
	set(current.list, {
		'flex-direction': edges.reverse ? 'column-reverse' : 'column',
		'align-items': edges.align,
	});
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

type Stack = {
	host: HTMLElement;
	root: ShadowRoot;
	list: HTMLElement;
	// Oldest first.
	closers: Array<() => void>;
};

let stack: Stack | undefined;
// Notices render in the order they were asked for, though each reads the theme asynchronously.
let queue: Promise<void> = Promise.resolve();

function createStack(theme: Theme): Stack {
	// One left by an earlier copy of this script, after an extension update, is not in `stack`.
	document.querySelector(`#${HOST_ID}`)?.remove();
	const host = document.createElement('div');
	host.id = HOST_ID;
	set(host, {
		all: 'initial',
		position: 'fixed',
		'z-index': '2147483647',
		display: 'block',
		width: 'min(448px, calc(100vw - 32px))',
		'pointer-events': 'none',
		'color-scheme': theme,
	});
	// A press on a notice is not a press on the page, so the site's bubbling listeners (one that closes a menu on an
	// outside press, say) don't act on it.
	for (const type of ['pointerdown', 'mousedown', 'click']) {
		host.addEventListener(type, (event) => {
			event.stopPropagation();
		});
	}

	const root = host.attachShadow({mode: 'closed'});
	const list = document.createElement('div');
	// Newest last, so it sits nearest the edge; place() sets the direction and the alignment.
	set(list, {display: 'flex', gap: '8px'});
	root.append(list);
	document.documentElement.append(host);
	return {host, root, list, closers: []};
}

/**
Shows a notice. `error` marks a save that failed, in the destructive color, as the extension's error toasts are.
`asking` marks a question (the saved page catch-up), which stays longer. Each call adds a notice of its own, with
its own buttons and timer, so a later one never takes an earlier one's Undo away.
*/
export function showSourceToast(
	text: string,
	{
		actions = [],
		error = false,
		asking = false,
	}: {actions?: ToastAction[]; error?: boolean; asking?: boolean} = {},
) {
	queue = queue
		.then(async () => Promise.all([readAppearance(), readPrefs()]))
		.then(([{theme, accent}, prefs]) => {
			render(text, {
				actions,
				error,
				asking,
				theme,
				accent,
				prefs,
			});
		});
}

function render(
	text: string,
	{
		actions: given,
		error,
		asking,
		theme,
		accent,
		prefs,
	}: {
		actions: ToastAction[];
		error: boolean;
		asking: boolean;
		theme: Theme;
		accent: string;
		prefs: ToastPrefs;
	},
) {
	// The host is gone when the page removed it (or a later copy of this script did); start a new one.
	if (!stack || !document.documentElement.contains(stack.host)) {
		stack = createStack(theme);
	}

	const current = stack;
	while (current.closers.length >= MAX_TOASTS) {
		current.closers[0]();
	}

	const {host, root, list} = current;
	// Until dismissed closes nothing by itself, so a notice with no button of its own gets one (a button that answers
	// with nothing closes the notice).
	const actions: ToastAction[] =
		prefs.duration === 'dismiss' && given.length === 0
			? [{label: 'Close', run: async () => undefined}]
			: given;

	set(host, {'color-scheme': theme});
	place(current, prefs.position);
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
		'box-sizing': 'border-box',
		'max-width': '100%',
		'pointer-events': 'auto',
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

	// Each button with the action it runs now: none once it reads Close.
	type ToastButton = {action?: ToastAction; button: HTMLButtonElement};
	const buttons = actions.map((action): ToastButton => {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = action.label;
		set(button, {
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
			// One line, so the row never gets narrower than its widest label: a label wider than the row runs over the
			// text ("Also save on Stack Overflow").
			'white-space': 'nowrap',
			'text-decoration': 'none',
			'text-underline-offset': '4px',
			outline: '2px solid transparent',
			'outline-offset': '0',
			cursor: 'pointer',
		});
		// The ring shows for keyboard focus only, as on the extension's pages.
		button.addEventListener('focus', () => {
			if (button.matches(':focus-visible')) {
				// An outline, not a shadow, so forced-colors mode still shows it.
				set(button, {'outline-color': colors.primary});
			}
		});
		button.addEventListener('blur', () => {
			set(button, {'outline-color': 'transparent'});
		});
		button.addEventListener('pointerenter', () => {
			set(button, {'text-decoration': 'underline'});
		});
		button.addEventListener('pointerleave', () => {
			set(button, {'text-decoration': 'none'});
		});
		return {action, button};
	});
	if (buttons.length > 0) {
		const row = document.createElement('div');
		set(row, {
			display: 'flex',
			'flex-wrap': 'wrap',
			'justify-content': 'flex-end',
			gap: '4px',
			flex: '0 1 auto',
		});
		row.append(...buttons.map(({button}) => button));
		box.append(row);
	}

	list.append(box);
	requestAnimationFrame(() => {
		message.textContent = text;
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	let held = false;
	let previous: HTMLElement | undefined;
	let closed = false;
	// Runs once. A closed notice whose Undo finishes later must not arm a timer again.
	const close = () => {
		if (closed) {
			return;
		}

		closed = true;
		current.closers = current.closers.filter((closer) => closer !== close);
		clearTimeout(timer);
		const hadFocus =
			root.activeElement !== null && box.contains(root.activeElement);
		box.remove();
		if (current.closers.length === 0) {
			host.remove();
			if (stack === current) {
				stack = undefined;
			}
		}

		if (hadFocus && previous?.isConnected) {
			previous.focus();
		}
	};

	current.closers.push(close);
	const schedule = () => {
		clearTimeout(timer);
		const ms = toastMs(asking ? ASKING_VISIBLE_MS : VISIBLE_MS, prefs.duration);
		if (!held && !closed && ms !== undefined) {
			timer = setTimeout(close, ms);
		}
	};

	const hold = (value: boolean) => {
		held = value;
		schedule();
	};

	box.addEventListener('pointerenter', () => hold(true));
	box.addEventListener('pointerleave', () => hold(false));
	box.addEventListener('focusin', (event) => {
		// Only focus arriving from the page counts; moving between the notice's own buttons keeps the page target.
		if (
			event.relatedTarget instanceof HTMLElement &&
			event.relatedTarget !== host &&
			!root.contains(event.relatedTarget)
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
	// After an action its button becomes Close or the next step's button and the others go, so focus stays on it
	// rather than falling to the page body.
	const run = async (entry: ToastButton) => {
		const {action, button} = entry;
		if (button.getAttribute('aria-disabled') === 'true') {
			return;
		}

		if (!action) {
			close();
			return;
		}

		for (const other of buttons) {
			if (other.button !== button) {
				other.button.remove();
			}
		}

		button.setAttribute('aria-disabled', 'true');
		const next = await action.run();
		if (next === undefined) {
			close();
			return;
		}

		const step = typeof next === 'string' ? {text: next} : next;
		message.textContent = step.text;
		entry.action = step.action;
		button.textContent = step.action?.label ?? 'Close';
		button.removeAttribute('aria-disabled');
		schedule();
	};

	for (const entry of buttons) {
		entry.button.addEventListener('click', () => void run(entry));
	}

	schedule();
}
