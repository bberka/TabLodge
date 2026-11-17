// GitHub stars: notices the user clicking Star on a repository, on its page or in a list (Trending, a profile's
// repositories). Two kinds of markup:
//   - a Star button in a form posting to `/<owner>/<repo>/star`; the Unstar form next to it posts to `/unstar`,
//     and the page shows one or the other. The form names the repository, in every interface language.
//   - a repository page drawn by React: one `data-testid="star-button"` reading "Star" or "Starred"; the
//     repository is the page's.
// The title is `<owner>/<repo>` and the description, when the page shows one: in the About box of the
// repository's page, or in the list row the button is in.
import {githubRepoUrl} from './site-sources';
import {
	controlLabel,
	eventElements,
	excerpt,
	type SourceLink,
	type SourceRead,
	type SourceReader,
} from './source-reader';

const STAR_FORM = /^\/[^/]+\/[^/]+\/(un)?star$/;
const LIST_ROW = 'article, li, .Box-row';
const ABOUT =
	'.BorderGrid p.f4, .Layout-sidebar p.f4, [class^="description__"]';
const STAR_BUTTON = '[data-testid="star-button"]';
// A Star button by its label, for a page that no longer wraps it in the form.
const STAR_LABEL = /^star\b/i;
const UNSTAR_LABEL = /^(?:unstar|starred)/i;

function description(form: Element, document: Document, repo: string) {
	const text =
		githubRepoUrl(document.location.href) === repo
			? document.querySelector(ABOUT)?.textContent
			: form.closest(LIST_ROW)?.querySelector(':scope p')?.textContent;
	return excerpt(text);
}

function repoLink(
	url: string,
	context: Element,
	document: Document,
): SourceLink {
	const name = new URL(url).pathname.slice(1);
	const about = description(context, document, url);
	return {url, title: about ? `${name}: ${about}` : name};
}

/**
A Star button outside its form: on a repository's own page the page is the repository; anywhere else it cannot
be told.
*/
function starWithoutForm(button: Element, document: Document): SourceRead {
	const url = button.closest('article, .Box-row')
		? null
		: githubRepoUrl(document.location.href);
	return url
		? {kind: 'save', link: repoLink(url, button, document)}
		: {kind: 'unreadable'};
}

export function createGithubReader(document: Document): SourceReader {
	return (event) => {
		const path = eventElements(event);
		const button = path.find((element) =>
			element.matches(`button, [type="submit"], ${STAR_BUTTON}`),
		);
		if (!button) {
			return undefined;
		}

		if (button.matches(STAR_BUTTON)) {
			return UNSTAR_LABEL.test(controlLabel(button))
				? undefined
				: starWithoutForm(button, document);
		}

		const form = path.find((element) => element.matches('form[action]'));
		const action = form
			? new URL(form.getAttribute('action') ?? '', 'https://github.com/')
			: undefined;
		const match = action && STAR_FORM.exec(action.pathname);
		if (!form || !action || !match) {
			return STAR_LABEL.test(controlLabel(button))
				? starWithoutForm(button, document)
				: undefined;
		}

		// An Unstar, or a star on something that is not a repository (a topic), saves nothing.
		const url = match[1]
			? null
			: githubRepoUrl(action.href.replace(/\/star$/, ''));
		return url
			? {kind: 'save', link: repoLink(url, form, document)}
			: undefined;
	};
}
