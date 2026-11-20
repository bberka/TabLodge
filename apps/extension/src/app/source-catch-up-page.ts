// The content script's half of the saved page catch-up (#377). On the site's saved page it reads the items listed
// there and asks the worker how many TabLodge lacks; when the worker says to ask, a toast offers to add them. It
// watches the page, because sites load their saved page in place and add items as the user scrolls, but it only
// reads: it clicks nothing, changes nothing on the site, and sends no request.
import type {ActionResult} from '../shared/types';
import {
	CATCH_UP_MAX_LINKS,
	catchUpCountText,
	type SavedPageReader,
} from './source-catch-up';
import type {SiteSource} from './site-sources';
import type {SourceLink} from './source-reader';
import {showSourceToast, type ToastAction} from './source-toast';

// The page is read at most this often while it changes; Reddit's pages change all the time.
const READ_EVERY_MS = 1000;
// A count the worker could not answer (an update restarting it) is asked again, this many times in a row.
const RETRIES = 3;

type Send = <T>(message: Record<string, unknown>) => Promise<T | undefined>;

export function watchSavedPage({
	source,
	read,
	send,
	appName,
	undo,
}: {
	source: SiteSource;
	read: SavedPageReader;
	send: Send;
	appName: string;
	undo: (id: string) => Promise<string>;
}) {
	// The addresses last asked about, so the toast's own insertion and unrelated page changes don't ask again.
	let lastAsked = '';
	// Answers can come back out of order; only the newest request's answer is shown.
	let latestRequest = 0;
	let failures = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const add = async (links: SourceLink[]) => {
		const result = await send<ActionResult<'SITE_SOURCE_CATCH_UP_ADD'>>({
			type: 'SITE_SOURCE_CATCH_UP_ADD',
			source: source.id,
			links,
		});
		if (!result) {
			return `${appName} could not add them.`;
		}

		if (!result.ok) {
			return result.error;
		}

		const {added, column, undoId} = result;
		const text =
			added === 0
				? `Nothing to add: they're in ${appName} already.`
				: `Added ${added} to ${appName} in ${column}.`;
		return undoId
			? {text, action: {label: 'Undo', run: async () => undo(undoId)}}
			: text;
	};

	// Not now: closes the notice once the answer is stored, and otherwise says so and offers it again.
	const dismiss = async (
		links: SourceLink[],
	): Promise<{text: string; action: ToastAction} | undefined> => {
		const result = await send<ActionResult<'SITE_SOURCE_CATCH_UP_DISMISS'>>({
			type: 'SITE_SOURCE_CATCH_UP_DISMISS',
			source: source.id,
			links,
		});
		return result?.ok
			? undefined
			: {
					text: `${appName} could not save that answer.`,
					action: {label: 'Try again', run: async () => dismiss(links)},
				};
	};

	const check = async () => {
		const loaded = read(document);
		const links = loaded?.slice(0, CATCH_UP_MAX_LINKS);
		if (!links?.length) {
			// Off the saved page (YouTube and X change pages in place): an answer still on its way is for a list
			// that is gone, and coming back asks again.
			latestRequest++;
			lastAsked = '';
			return;
		}

		const key = JSON.stringify(links.map((link) => link.url));
		if (key === lastAsked) {
			return;
		}

		lastAsked = key;
		const request = ++latestRequest;
		const result = await send<ActionResult<'SITE_SOURCE_CATCH_UP'>>({
			type: 'SITE_SOURCE_CATCH_UP',
			source: source.id,
			links,
		});
		if (request !== latestRequest) {
			return;
		}

		if (!result?.ok) {
			if (++failures <= RETRIES) {
				lastAsked = '';
				settle();
			}

			return;
		}

		failures = 0;
		if (!result.ask) {
			return;
		}

		const cut =
			loaded && loaded.length > links.length
				? ` Only the first ${links.length} were checked.`
				: '';
		showSourceToast(catchUpCountText(result.missing, appName) + cut, {
			asking: true,
			actions: [
				{label: 'Add them', run: async () => add(links)},
				{
					label: 'Not now',
					run: async () => dismiss(links),
				},
			],
		});
	};

	const settle = () => {
		timer ??= setTimeout(() => {
			timer = undefined;
			void check();
		}, READ_EVERY_MS);
	};

	new MutationObserver(settle).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
	settle();
	// Settings changed (a site removed and added again forgets its Not now answers): count the page again.
	return {
		refresh() {
			lastAsked = '';
			latestRequest++;
			settle();
		},
	};
}
