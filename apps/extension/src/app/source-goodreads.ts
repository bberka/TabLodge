// Want to Read on Goodreads: notices the user shelving a book as Want to Read, by either of the site's controls:
//   - on a book's page, the Want to Read button (`button.Button--wtr`). Once the book is on a shelf it is replaced by
//     a button that edits the shelf, so a `Button--wtr` click is always an add. The arrow beside it
//     ("…choose a shelf…") only opens the shelf list and saves nothing.
//   - on older list pages, the Want to Read button of a form posting to `/shelf/add_to_shelf` with `name=to-read`.
// On a book's page the book is the page; in a list it is the row's title link.
import {goodreadsBookUrl} from './site-sources';
import {
	controlLabel,
	eventElements,
	squash,
	savedOrUnreadable,
	type SourceReader,
} from './source-reader';

const PAGE_SAVE = 'button.Button--wtr';
const CHOOSE_SHELF = /choose a shelf/i;
const SHELF_FORM = 'form[action*="/shelf/add_to_shelf"]';
const ROW = 'tr, .elementList, li';
const ROW_TITLE = 'a.bookTitle[href*="/book/show/"]';
const PAGE_TITLE = 'h1[data-testid="bookTitle"], h1';

export function createGoodreadsReader(document: Document): SourceReader {
	return (event) => {
		const path = eventElements(event);
		const button = path.find((element) =>
			element.matches('button, input[type="submit"]'),
		);
		if (!button) {
			return undefined;
		}

		if (button.matches(PAGE_SAVE)) {
			if (CHOOSE_SHELF.test(controlLabel(button))) {
				return undefined;
			}

			const url = goodreadsBookUrl(document.location.href);
			const title = squash(document.querySelector(PAGE_TITLE)?.textContent);
			return savedOrUnreadable(url, title);
		}

		const form = button.closest(SHELF_FORM);
		if (
			!form ||
			form.querySelector('input[name="name"]')?.getAttribute('value') !==
				'to-read'
		) {
			return undefined;
		}

		const titleLink = form.closest(ROW)?.querySelector(ROW_TITLE);
		const url = goodreadsBookUrl(titleLink?.getAttribute('href') ?? '');
		const title = squash(titleLink?.textContent);
		return savedOrUnreadable(url, title);
	};
}
