// Lobsters saved: notices the user clicking "save" on a story, in a list or on the story's page. The control is a
// submit input in `form.saver`, inside `li.story[data-shortid]`; its value turns to "unsave" once saved, and the
// site sends the form with a script, so the page stays. The story's title link (`a.u-url`) points to the article,
// or to the story's own page for a text post; the comments link is the story's own page.
import {lobstersStoryUrl} from './site-sources';
import {eventElements, squash, type SourceReader} from './source-reader';

const SUBMIT = 'input[type="submit"], button';

export function createLobstersReader(): SourceReader {
	return (event) => {
		const path = eventElements(event);
		const control = path.find((element) => element.matches(SUBMIT));
		const form =
			control && path.find((element) => element.matches('form.saver'));
		const label = squash(
			control?.getAttribute('value') ?? control?.textContent,
		);
		if (!form || !/^save$/i.test(label)) {
			return undefined;
		}

		const story = path.find((element) => element.matches('.story'));
		const id = (story as HTMLElement | undefined)?.dataset.shortid ?? '';
		// A story page lists merged stories in one item, each in its own details block with its own save.
		const title = (form.closest('.details') ?? story)?.querySelector(
			':scope a.u-url[href]',
		);
		const comments = [
			...(story?.querySelectorAll(':scope a[href^="/s/"]') ?? []),
		].find((link) => link.getAttribute('href')?.startsWith(`/s/${id}/`));
		const discussion = lobstersStoryUrl(
			comments?.getAttribute('href') ?? `/s/${id}`,
		);
		if (!title || !discussion || !/^[\da-z]+$/i.test(id)) {
			return {kind: 'unreadable'};
		}

		return {
			kind: 'save',
			link: {
				url: new URL(title.getAttribute('href') ?? '', 'https://lobste.rs/')
					.href,
				title: squash(title.textContent),
				discussion,
			},
		};
	};
}
