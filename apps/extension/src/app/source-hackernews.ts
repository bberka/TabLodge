// Hacker News favorites: notices the user clicking "favorite" on a story, on its page or in a list. The link is
// `fave?id=<id>&auth=…` in the story's subtext row; once favorited it reads "un-favorite" and carries `un=t`.
// The story is the `tr.athing` row whose id is the item id, with its title link in `.titleline`. A favorite on a
// comment (a row with comment text) saves nothing.
import {hackerNewsItemUrl} from './site-sources';
import {
	controlLabel,
	eventElements,
	squash,
	type SourceReader,
} from './source-reader';

const FAVE = 'a[href^="fave?"], a[href*="/fave?"]';

export function createHackerNewsReader(document: Document): SourceReader {
	return (event) => {
		const link = eventElements(event).find((element) => element.matches(FAVE));
		if (!link || !/^favorite$/i.test(controlLabel(link))) {
			return undefined;
		}

		const href = new URL(
			link.getAttribute('href') ?? '',
			'https://news.ycombinator.com/',
		);
		if (href.searchParams.has('un')) {
			return undefined;
		}

		const id = href.searchParams.get('id') ?? '';
		if (!/^\d{1,12}$/.test(id)) {
			return {kind: 'unreadable'};
		}

		const row = [...document.querySelectorAll('tr.athing')].find(
			(element) => element.id === id,
		);
		if (row?.matches('.comtr') || row?.querySelector(':scope .commtext')) {
			return undefined;
		}

		const title = row?.querySelector(':scope .titleline > a[href]');
		const discussion = hackerNewsItemUrl(`item?id=${id}`);
		if (!title || !discussion) {
			return {kind: 'unreadable'};
		}

		return {
			kind: 'save',
			link: {
				url: new URL(
					title.getAttribute('href') ?? '',
					'https://news.ycombinator.com/',
				).href,
				title: squash(title.textContent),
				discussion,
			},
		};
	};
}
