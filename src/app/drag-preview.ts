// Compact drag previews for the session manager: a small card instead of the full-width row.
// The card is built offscreen, handed to setDragImage, and removed right after the browser snapshots it.
import {faviconUrl} from './favicon';
import {hostOf} from './web-url';

type PreviewLink = {url: string; title?: string};
type ImageTarget = {
	setDragImage?: (image: Element, x: number, y: number) => void;
};

function box(styles: Record<string, string>) {
	const element = document.createElement('div');
	Object.assign(element.style, {
		position: 'fixed',
		top: '-1000px',
		left: '-1000px',
		display: 'flex',
		alignItems: 'center',
		gap: '10px',
		maxWidth: '280px',
		padding: '8px 12px',
		borderRadius: '12px',
		border: '1px solid rgb(var(--primary) / 0.45)',
		background: 'rgb(var(--card))',
		color: 'rgb(var(--foreground))',
		boxShadow: '0 8px 24px rgb(0 0 0 / 0.22)',
		font: '13px/1.3 system-ui, sans-serif',
		pointerEvents: 'none',
		...styles,
	});
	return element;
}

function icon(url: string, size: number, round = false) {
	const wrapper = document.createElement('span');
	Object.assign(wrapper.style, {
		flex: 'none',
		width: `${size}px`,
		height: `${size}px`,
		borderRadius: round ? '999px' : '6px',
		overflow: 'hidden',
		background: 'rgb(var(--muted))',
		display: 'inline-block',
	});
	const image = document.createElement('img');
	image.src = faviconUrl(url);
	image.alt = '';
	Object.assign(image.style, {
		width: '100%',
		height: '100%',
		objectFit: 'contain',
		background: 'rgb(var(--card))',
	});
	wrapper.append(image);
	return wrapper;
}

function text(value: string, styles: Record<string, string>) {
	const element = document.createElement('div');
	element.textContent = value;
	Object.assign(element.style, {
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		...styles,
	});
	return element;
}

function show(dataTransfer: ImageTarget | null | undefined, card: HTMLElement) {
	if (!dataTransfer?.setDragImage) {
		return;
	}

	document.body.append(card);
	dataTransfer.setDragImage(card, 16, 16);
	setTimeout(() => {
		card.remove();
	}, 0);
}

/**
Drag image for a whole session: name, tab count, and a few favicons.
*/
export function setSessionDragImage(
	dataTransfer: ImageTarget | null | undefined,
	session: {name: string; tabs: readonly PreviewLink[]},
) {
	const card = box({});
	const body = document.createElement('div');
	body.style.minWidth = '0';
	body.append(
		text(session.name, {fontWeight: '600'}),
		text(
			`${session.tabs.length} ${session.tabs.length === 1 ? 'tab' : 'tabs'}`,
			{fontSize: '11px', color: 'rgb(var(--muted-foreground))'},
		),
	);
	const icons = document.createElement('div');
	Object.assign(icons.style, {display: 'flex', flex: 'none'});
	for (const [index, tab] of session.tabs.slice(0, 4).entries()) {
		const chip = icon(tab.url, 20, true);
		chip.style.marginLeft = index === 0 ? '0' : '-6px';
		chip.style.boxShadow = '0 0 0 2px rgb(var(--card))';
		icons.append(chip);
	}

	card.append(body, icons);
	show(dataTransfer, card);
}

/**
Drag image for one saved link: favicon, title, and domain.
*/
export function setLinkDragImage(
	dataTransfer: ImageTarget | null | undefined,
	link: PreviewLink,
) {
	const card = box({});
	const body = document.createElement('div');
	body.style.minWidth = '0';
	body.append(
		text(link.title?.trim() || hostOf(link.url), {fontWeight: '600'}),
		text(hostOf(link.url), {
			fontSize: '11px',
			color: 'rgb(var(--muted-foreground))',
		}),
	);
	card.append(icon(link.url, 24), body);
	show(dataTransfer, card);
}
