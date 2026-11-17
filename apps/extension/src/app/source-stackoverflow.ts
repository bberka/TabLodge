// Stack Overflow bookmarks: notices the user clicking the bookmark (Save) button beside a question. The button is
// `.js-saves-btn` (`.js-bookmark-btn` on older pages) with the post's id and type, and `aria-pressed="true"` once
// the post is saved. A save on an answer (post type 2) is not a question and saves nothing. The question's address
// and title come from the link in the page's heading, which carries the same id.
import {stackOverflowQuestionUrl} from './site-sources';
import {eventElements, squash, type SourceReader} from './source-reader';

const SAVE = '.js-saves-btn, .js-bookmark-btn';
const HEADING_LINK = '#question-header h1 a[href], h1 a.question-hyperlink';

export function createStackOverflowReader(document: Document): SourceReader {
	return (event) => {
		const button = eventElements(event).find((element) =>
			element.matches(SAVE),
		);
		if (
			!button ||
			button.getAttribute('aria-pressed') === 'true' ||
			(button as HTMLElement).dataset.postTypeId === '2'
		) {
			return undefined;
		}

		const id = (button as HTMLElement).dataset.postId;
		const heading = document.querySelector(HEADING_LINK);
		const url = stackOverflowQuestionUrl(heading?.getAttribute('href') ?? '');
		return !heading ||
			!url ||
			!id ||
			new URL(url).pathname.split('/', 3)[2] !== id
			? {kind: 'unreadable'}
			: {kind: 'save', link: {url, title: squash(heading.textContent)}};
	};
}
