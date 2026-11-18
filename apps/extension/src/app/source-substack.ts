// Saved posts on Substack: notices the user clicking Save on a post, a button labelled "Save" that reads
// `aria-pressed="true"` (and "Unsave") once the post is saved; a click then un-saves, which saves nothing. The button
// is found by its English label, so in another interface language nothing is saved. In a feed the post is the
// link in the card around the button; elsewhere it is the page, when the page is a post.
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

/**
The feed card around the button: the nearest of its few closest ancestors that holds one post preview title. A
card is small, so the search stops early and never takes a container of several previews; on a post's own page it
never reaches the previews of other posts further down.
*/
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
				// Resolved against the page, so a relative link keeps the publication's host.
				.map((link) =>
					substackPostUrl(
						new URL(link.getAttribute('href') ?? '', document.location.href)
							.href,
					),
				)
				.find(Boolean);
			const title = squash(found.title.textContent);
			return savedOrUnreadable(url, title);
		}

		const url = substackPostUrl(document.location.href);
		const title = squash(document.querySelector(PAGE_TITLE)?.textContent);
		return savedOrUnreadable(url, title);
	};
}
