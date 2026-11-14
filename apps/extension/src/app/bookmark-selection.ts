/*
Which bookmarks are selected on the board: click to toggle one, shift click to take the range from the last one
clicked (in the order the cards appear on screen), Escape to clear. The rules are plain functions; the hook adds
the state and the keyboard listeners.
*/
import {useCallback, useEffect, useRef, useState} from 'react';

/**
The selection after clicking `id`. A plain click toggles it; a range click adds everything between the anchor (the
last bookmark clicked) and `id` in `order`, or just `id` when the anchor is not on screen.
*/
export function toggleSelection(
	selected: ReadonlySet<string>,
	order: readonly string[],
	anchor: string | null,
	id: string,
	range: boolean,
): Set<string> {
	const next = new Set(selected);
	if (!range) {
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}

		return next;
	}

	const first = order.indexOf(anchor ?? '');
	const last = order.indexOf(id);
	const ids =
		first !== -1 && last !== -1
			? order.slice(Math.min(first, last), Math.max(first, last) + 1)
			: [id];
	for (const entry of ids) {
		next.add(entry);
	}

	return next;
}

/**
The selection without bookmarks that no longer exist. Returns the same set when nothing was dropped.
*/
export function pruneSelection<T extends ReadonlySet<string>>(
	selected: T,
	existing: ReadonlyArray<{id: string}>,
): T | Set<string> {
	const alive = new Set(existing.map((entry) => entry.id));
	const next = new Set([...selected].filter((id) => alive.has(id)));
	return next.size === selected.size ? selected : next;
}

const onScreenOrder = () =>
	[
		...document.querySelectorAll<HTMLElement>(
			'#bookmark-library [data-bookmark-id]',
		),
	].map((card) => card.dataset.bookmarkId || '');

export function useBookmarkSelection(bookmarks: ReadonlyArray<{id: string}>) {
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	// Alt held down shows the selection checkboxes without switching selection mode on.
	const [modifier, setModifier] = useState(false);
	const [enabled, setEnabled] = useState(false);
	const anchorRef = useRef<string | null>(null);

	const clear = useCallback(() => {
		setSelected(new Set());
		anchorRef.current = null;
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			setModifier(event.altKey);
			if (
				!(event.type === 'keydown' && event.key === 'Escape') ||
				event.defaultPrevented ||
				document.querySelector('[role="dialog"], [role="menu"]')
			) {
				return;
			}

			clear();
			setEnabled(false);
		};

		const reset = () => setModifier(false);
		globalThis.addEventListener('keydown', onKey);
		globalThis.addEventListener('keyup', onKey);
		window.addEventListener('blur', reset);
		return () => {
			globalThis.removeEventListener('keydown', onKey);
			globalThis.removeEventListener('keyup', onKey);
			window.removeEventListener('blur', reset);
		};
	}, [clear]);

	useEffect(() => {
		setSelected((old) => pruneSelection(old, bookmarks));
	}, [bookmarks]);

	const toggle = (id: string, range = false) => {
		const order = onScreenOrder();
		setEnabled(true);
		setSelected((old) =>
			toggleSelection(old, order, anchorRef.current, id, range),
		);
		anchorRef.current = id;
	};

	return {selected, modifier, enabled, setEnabled, toggle, clear};
}
