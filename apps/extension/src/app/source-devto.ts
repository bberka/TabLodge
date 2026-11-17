// Reading list on dev.to: notices the user clicking Save on an article, by either of the site's two controls:
//   - on the article's page, the reading list button in the reactions bar (`data-category="readinglist"`)
//   - on a feed card, the Save button (`article-save-button-<id>`, labelled "Save post <title> to reading list")
// Once the article is saved they carry `aria-pressed="true"` or, on server drawn cards, the class `selected`; a
// click then un-saves, which saves nothing. Both are found by their markup, so they work in every interface
// language. On a card the article is the card's title link; on the article's page it is the page's own address
// (the canonical link may name another site the article was first published on).
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
