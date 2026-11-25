import {hackerNewsItemUrl} from './site-sources';
import {
	controlLabel,
	eventElements,
	squash,
	type SourceReader,
} from './source-reader';

const FAVE = 'a[href^="fave?"]';

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
