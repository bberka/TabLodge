import {substackPostUrl} from './site-sources';
import {
	controlLabel,
	eventElements,
	squash,
	savedOrUnreadable,
	type SourceReader,
} from './source-reader';

const SAVE_LABEL = /^save$/i;
const CARD_TITLE = '[data-testid="post-preview-title"]';
const CARD_DEPTH = 6;
const PAGE_TITLE = 'h1.post-title, h1';

function card(button: Element, document: Document) {
	let container = button.parentElement;
	for (
		let depth = 0;
		container && container !== document.body && depth < CARD_DEPTH;
		depth++
	) {
		const titles = container.querySelectorAll(CARD_TITLE);
		if (titles.length > 1) {
			return undefined;
		}

		if (titles[0]) {
			return {container, title: titles[0]};
		}

		container = container.parentElement;
	}

	return undefined;
}

export function createSubstackReader(document: Document): SourceReader {
	return (event) => {
		const button = eventElements(event).find((element) =>
			element.matches('button[aria-pressed]'),
		);
		if (
			!button ||
			button.getAttribute('aria-pressed') === 'true' ||
			!SAVE_LABEL.test(controlLabel(button))
		) {
			return undefined;
		}

		const found = card(button, document);
		if (found) {
			const url = [...found.container.querySelectorAll('a[href]')]
				.map((link) =>
					substackPostUrl(
						link.getAttribute('href') ?? '',
						document.location.href,
					),
				)
				.filter((url) => url !== substackPostUrl(document.location.href))
				.find(Boolean);
			const title = squash(found.title.textContent);
			return savedOrUnreadable(url, title);
		}

		const url = substackPostUrl(document.location.href);
		const title = squash(document.querySelector(PAGE_TITLE)?.textContent);
		return savedOrUnreadable(url, title);
	};
}
