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
