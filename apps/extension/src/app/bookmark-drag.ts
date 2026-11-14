/*
Drag and drop on the bookmark board: what a drop carries (a column, a bookmark, links from another page or app), where
it would land, and how a pasted or dropped link is read. The board's React code owns state and persistence; this holds
the rules that need no component, so they run in tests without a browser.
*/
import type {DragEvent} from 'react';
import type {InsertPosition, LinkEntry} from '../shared/types';
import {
	BOOKMARK_DRAG_TYPE,
	applyLinkDrag,
	COLUMN_DRAG_TYPE,
	dragPayloadKind,
	parseDraggedLink,
} from './interaction-actions';
import {siteName, webUrl} from './web-url';

export type DragKind = NonNullable<ReturnType<typeof dragPayloadKind>>;

/**
Where a drag would land: a column edge (column drags) or a slot next to a bookmark card.
*/
export type DropIndicator = {
	kind: DragKind;
	columnId: string;
	targetBookmarkId?: string | null;
	position: InsertPosition;
};

export function parseDraggedBookmark(
	dataTransfer: DataTransfer | null,
): LinkEntry | null {
	const link = parseDraggedLink(dataTransfer);
	return link && {url: link.url, title: link.title || siteName(link.url)};
}

const MAX_PASTED_LINKS = 500;

/**
Every web link in pasted content: one per line in plain text or a URI list, or each link in copied HTML. Lines
that are not a web address are ignored, and repeated addresses are kept once.
*/
export function parsePastedLinks(
	dataTransfer: DataTransfer | null,
): LinkEntry[] {
	if (!dataTransfer) {
		return [];
	}

	const links = new Map<string, LinkEntry>();
	const add = (raw: string, title = '') => {
		const url = webUrl(raw);
		if (url && !links.has(url) && links.size < MAX_PASTED_LINKS) {
			links.set(url, {
				url,
				title: title
					.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
					.trim()
					.slice(0, 500),
			});
		}
	};

	const html = dataTransfer.getData('text/html');
	if (html) {
		for (const anchor of new DOMParser()
			.parseFromString(html, 'text/html')
			.querySelectorAll('a[href]')) {
			add(anchor.getAttribute('href') || '', anchor.textContent || '');
		}
	}

	if (links.size < 2) {
		links.clear();
		const text = [
			dataTransfer.getData('text/uri-list'),
			dataTransfer.getData('text/plain'),
		].join('\n');
		for (const line of text.split(/\r?\n/)) {
			if (!line.trimStart().startsWith('#')) {
				add(line);
			}
		}
	}

	return [...links.values()];
}

// Column, bookmark, session, and link drags are accepted by columns; Unfiled takes all but columns.
export function acceptsDrop(
	event: DragEvent<HTMLElement>,
	allowColumn: boolean,
) {
	const kind = dragPayloadKind(event.dataTransfer?.types);
	return Boolean(kind) && (allowColumn || kind !== 'column');
}

export function previewBookmarkDrop(
	event: DragEvent<HTMLElement>,
	columnId: string,
	onDropOver: (indicator: DropIndicator | null) => void,
	allowColumn: boolean,
) {
	if (!acceptsDrop(event, allowColumn)) {
		return;
	}

	event.preventDefault();
	const kind = dragPayloadKind(event.dataTransfer.types);
	if (!kind) {
		return;
	}

	if (kind === 'column') {
		const rect = event.currentTarget.getBoundingClientRect();
		onDropOver({
			kind,
			columnId,
			position: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after',
		});
		return;
	}

	event.dataTransfer.dropEffect = kind === 'bookmark' ? 'move' : 'copy';
	const targetCard = (event.target as Element).closest<HTMLElement>(
		'[data-bookmark-id]',
	);
	const rect = targetCard?.getBoundingClientRect();
	onDropOver({
		kind,
		columnId,
		targetBookmarkId: targetCard?.dataset.bookmarkId || null,
		position:
			targetCard && rect && event.clientY < rect.top + rect.height / 2
				? 'before'
				: 'after',
	});
}

export function handleInternalDragStart(
	event: DragEvent<HTMLElement>,
	count = 1,
	links: LinkEntry[] = [],
) {
	const handle = (event.target as Element).closest<HTMLElement>(
		'[data-drag-column]',
	);
	const card = (event.target as Element).closest<HTMLElement>(
		'[data-bookmark-id]',
	);
	if (handle) {
		event.dataTransfer.setData(COLUMN_DRAG_TYPE, handle.dataset.dragColumn!);
		event.dataTransfer.effectAllowed = 'move';
	} else if (card) {
		card.classList.add('is-dragging');
		setBookmarkDragImage(event, card, count);
		event.dataTransfer.setData(BOOKMARK_DRAG_TYPE, card.dataset.bookmarkId!);
		if (count > 1) {
			applyLinkDrag(event.dataTransfer, links, `${count} selected bookmarks`);
		} else {
			const link = card.dataset.bookmarkUrl;
			if (link) {
				event.dataTransfer.setData('text/uri-list', link);
				event.dataTransfer.setData('text/plain', link);
				event.dataTransfer.setData(
					'text/x-moz-url',
					`${link}\n${card.dataset.bookmarkTitle || ''}`,
				);
			}
		}

		event.dataTransfer.effectAllowed = 'copyMove';
	}
}

// A compact rounded card (favicon, title, domain) replaces the browser's default drag ghost.
function setBookmarkDragImage(
	event: DragEvent<HTMLElement>,
	card: HTMLElement,
	count: number,
) {
	const title = card.dataset.bookmarkTitle || '';
	const domain = card.dataset.bookmarkDomain || '';
	const ghost = document.createElement('div');
	Object.assign(ghost.style, {
		position: 'fixed',
		top: '-1000px',
		left: '-1000px',
		display: 'flex',
		alignItems: 'center',
		gap: '10px',
		width: '260px',
		padding: '8px 12px',
		borderRadius: '10px',
		border: '1px solid rgb(var(--border))',
		background: 'rgb(var(--card))',
		color: 'rgb(var(--foreground))',
		boxShadow: '0 8px 24px rgb(0 0 0 / 0.25)',
		font: '13px/1.3 system-ui, sans-serif',
		pointerEvents: 'none',
	});
	const icon = card.querySelector<HTMLImageElement>('img[data-favicon]');
	const mark = document.createElement(icon ? 'img' : 'span');
	if (icon && mark instanceof HTMLImageElement) {
		mark.src = icon.src;
	} else {
		mark.textContent = (domain[0] || '↗').toUpperCase();
	}

	Object.assign(mark.style, {
		width: '24px',
		height: '24px',
		flex: 'none',
		objectFit: 'contain',
		textAlign: 'center',
		lineHeight: '24px',
		fontWeight: '700',
	});
	const text = document.createElement('div');
	text.style.minWidth = '0';
	const strong = document.createElement('div');
	strong.textContent = count > 1 ? `${count} bookmarks` : title;
	Object.assign(strong.style, {
		fontWeight: '600',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	});
	const small = document.createElement('div');
	small.textContent = domain;
	Object.assign(small.style, {
		fontSize: '11px',
		color: 'rgb(var(--muted-foreground))',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	});
	text.append(strong, small);
	ghost.append(mark, text);
	document.body.append(ghost);
	event.dataTransfer.setDragImage(ghost, 24, 24);
	setTimeout(() => ghost.remove(), 0);
}

export function handleInternalDragEnd() {
	document
		.querySelectorAll('.is-dragging')
		.forEach((node) => node.classList.remove('is-dragging'));
}
