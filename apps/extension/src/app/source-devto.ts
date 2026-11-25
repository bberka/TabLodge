import {devtoArticleUrl} from './site-sources';
import {eventElements, squash, type SourceReader} from './source-reader';

const PAGE_SAVE = '[data-category="readinglist"]';
const CARD_SAVE =
	'[id^="article-save-button-"], .bookmark-button[data-reactable-id]';
const CARD = '.crayons-story, article';
const CARD_TITLE =
	':scope .crayons-story__title a[href], :scope a[id^="article-link-"]';
const PAGE_TITLE = '#main-title h1, .crayons-article__header h1';

export function createDevtoReader(document: Document): SourceReader {
	return (event) => {
		const path = eventElements(event);
		const button = path.find((element) =>
			element.matches(`${PAGE_SAVE}, ${CARD_SAVE}`),
		);
		if (
			!button ||
			button.getAttribute('aria-pressed') === 'true' ||
			button.classList.contains('selected')
		) {
			return undefined;
		}

		if (button.matches(PAGE_SAVE)) {
			const url = devtoArticleUrl(document.location.href);
			const title = squash(document.querySelector(PAGE_TITLE)?.textContent);
			return url && title
				? {kind: 'save', link: {url, title}}
				: {kind: 'unreadable'};
		}

		const link = button.closest(CARD)?.querySelector(CARD_TITLE);
		const url = devtoArticleUrl(link?.getAttribute('href') ?? '');
		return link && url
			? {kind: 'save', link: {url, title: squash(link.textContent)}}
			: {kind: 'unreadable'};
	};
}
