/**
Keeps keyboard and screen-reader focus near where the user was when the focused element disappears
(for example a session deleted from its menu, with an Undo toast instead of a confirmation).

While the user works, the last focused element outside menus and dialogs is remembered together with
its neighbors. When focus falls back to the page body and that element is gone, focus moves to the
nearest surviving neighbor (next, then previous, climbing the ancestors), and otherwise to the
heading of the section it was in.
*/

type Anchor = {
	element: Element;
	/**
	The element and each ancestor with the siblings it had when it was focused (up to the enclosing region).
	*/
	chain: Array<{
		node: Element;
		next: Element | null;
		previous: Element | null;
		parent: Element | null;
	}>;
	heading: string | null;
};

const TRANSIENT =
	'[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="tooltip"], [data-radix-popper-content-wrapper]';
const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const MAX_LEVELS = 8;
const REGION = 'section, main, header, nav, aside, [role="dialog"]';

const visible = (element: Element) =>
	element instanceof HTMLElement &&
	element.getClientRects().length > 0 &&
	getComputedStyle(element).visibility !== 'hidden';

function focusIn(root: Element | null): boolean {
	if (!root?.isConnected) {
		return false;
	}

	const candidates = root.matches(FOCUSABLE)
		? [root]
		: [...root.querySelectorAll(FOCUSABLE)];
	const target = candidates.find(
		(candidate) => visible(candidate) && !candidate.closest('[inert]'),
	);
	if (target instanceof HTMLElement) {
		target.focus({preventScroll: false});
		return document.activeElement === target;
	}

	return false;
}

function describe(element: Element): Anchor {
	const chain: Anchor['chain'] = [];
	let node: Element | null = element;
	for (let level = 0; node && level < MAX_LEVELS; level += 1) {
		const parent: Element | null = node.parentElement;
		if (!parent || parent === document.body || node.matches(REGION)) {
			break;
		}

		chain.push({
			node,
			parent,
			next: node.nextElementSibling,
			previous: node.previousElementSibling,
		});
		node = parent;
	}

	const section = element.closest('[aria-labelledby]');
	return {
		element,
		chain,
		heading: section?.getAttribute('aria-labelledby')?.split(' ', 1)[0] ?? null,
	};
}

function rescue(anchor: Anchor) {
	for (const {node, parent, next, previous} of anchor.chain) {
		if (node.isConnected) {
			// The focused element went away inside this node: stay inside it.
			if (focusIn(node)) {
				return;
			}

			continue;
		}

		// Nearest surviving sibling that is still next to where the removed node sat.
		for (let sibling = next; sibling; sibling = sibling.nextElementSibling) {
			if (sibling.parentElement === parent && focusIn(sibling)) {
				return;
			}
		}

		if (previous?.parentElement === parent) {
			for (
				let sibling: Element | null = previous;
				sibling;
				sibling = sibling.previousElementSibling
			) {
				if (focusIn(sibling)) {
					return;
				}
			}
		}
	}

	const heading = anchor.heading
		? document.querySelector(`#${CSS.escape(anchor.heading)}`)
		: null;
	if (heading instanceof HTMLElement) {
		heading.focus();
		if (document.activeElement === heading) {
			return;
		}
	}

	document.querySelector<HTMLElement>('main h1, h1')?.focus();
}

export function installFocusRescue() {
	let anchor: Anchor | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const check = (attempt: number) => {
		timer = undefined;
		const current = anchor;
		if (
			!current ||
			current.element.isConnected ||
			(document.activeElement && document.activeElement !== document.body)
		) {
			return;
		}

		// Dialogs trap focus themselves and hand it back when they close; wait for that.
		if (
			document.querySelector(
				'[role="dialog"], [role="alertdialog"], [role="menu"]',
			)
		) {
			if (attempt < 8) {
				timer = setTimeout(() => check(attempt + 1), 100);
			}

			return;
		}

		anchor = undefined;
		rescue(current);
	};

	const onFocusIn = (event: FocusEvent) => {
		const {target} = event;
		if (
			!(target instanceof Element) ||
			target === document.body ||
			target.closest(TRANSIENT)
		) {
			return;
		}

		anchor = describe(target);
	};

	const onFocusOut = (event: FocusEvent) => {
		if (event.relatedTarget) {
			return;
		}

		clearTimeout(timer);
		// Let React commit the removal and the menu or dialog hand focus back first.
		timer = setTimeout(() => requestAnimationFrame(() => check(0)), 0);
	};

	document.addEventListener('focusin', onFocusIn, {capture: true});
	document.addEventListener('focusout', onFocusOut, {capture: true});
	return () => {
		clearTimeout(timer);
		document.removeEventListener('focusin', onFocusIn, true);
		document.removeEventListener('focusout', onFocusOut, true);
	};
}
