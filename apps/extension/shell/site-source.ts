// The content script of Settings › Sources, registered for a site only while the user has it on and the browser
// grants the site's optional host permission. It only observes: it reads the page when the user clicks, and when
// the click was the site's own save, it hands that link to the service worker and shows the result in the page.
// It never changes the site's behavior, blocks its save, or makes a request of its own.
import {siteSourceForUrl, type SiteSourceId} from '../src/app/site-sources';
import type {SourceRead, SourceReader} from '../src/app/source-reader';
import {createDevtoReader} from '../src/app/source-devto';
import {createGithubReader} from '../src/app/source-github';
import {createHackerNewsReader} from '../src/app/source-hackernews';
import {createInstagramReader} from '../src/app/source-instagram';
import {createLobstersReader} from '../src/app/source-lobsters';
import {createRedditReader} from '../src/app/source-reddit';
import {createStackOverflowReader} from '../src/app/source-stackoverflow';
import {createTwitterReader} from '../src/app/source-x';
import {createYoutubeReader} from '../src/app/source-youtube';
import {showSourceToast} from '../src/app/source-toast';
import type {ActionResult, SiteSourceOutcome} from '../src/shared/types';

const LOADED = 'tablodgeSiteSource';
const PENDING_TAKE_DELAY_MS = 3000;
const READERS: Record<SiteSourceId, () => SourceReader> = {
	youtube: () => createYoutubeReader(document),
	reddit: () => createRedditReader(),
	x: () => createTwitterReader(document),
	instagram: () => createInstagramReader(document),
	github: () => createGithubReader(document),
	hackernews: () => createHackerNewsReader(document),
	stackoverflow: () => createStackOverflowReader(document),
	devto: () => createDevtoReader(document),
	lobsters: () => createLobstersReader(),
};
const source = siteSourceForUrl(location.href);

// Settings injects the script into open tabs when a site is switched on, so a second copy must stay quiet.
if (source && !Object.hasOwn(globalThis, LOADED)) {
	Object.defineProperty(globalThis, LOADED, {value: true});
	const appName = chrome.runtime.getManifest().short_name ?? 'TabLodge';
	const read = READERS[source.id]();

	// A script left behind by an extension update or removal can no longer reach the worker; it then does nothing.
	const send = async <T>(message: Record<string, unknown>) => {
		try {
			return (await chrome.runtime.sendMessage(message)) as T | undefined;
		} catch {
			return undefined;
		}
	};

	const undo = async (id: string) => {
		const result = await send<ActionResult<'SITE_SOURCE_UNDO'>>({
			type: 'SITE_SOURCE_UNDO',
			id,
		});
		return result?.ok
			? `Removed from ${appName}.`
			: (result?.error ?? `${appName} could not undo that.`);
	};

	const showSaved = ({
		outcome,
		column,
		undoId,
	}: {
		outcome: SiteSourceOutcome;
		column?: string;
		undoId?: string;
	}) => {
		const messages: Record<SiteSourceOutcome, string | undefined> = {
			saved: `Saved to ${appName} in ${column}.`,
			exists: `Already in ${appName}.`,
			trashed: `In the ${appName} trash bin, so not saved again.`,
			off: undefined,
		};
		const text = messages[outcome];
		if (text) {
			showSourceToast(text, {
				action: undoId
					? {label: 'Undo', run: async () => undo(undoId)}
					: undefined,
			});
		}
	};

	const takePending = async () =>
		send<ActionResult<'SITE_SOURCE_PENDING'>>({
			type: 'SITE_SOURCE_PENDING',
			source: source.id,
		});

	const handle = async (found: NonNullable<SourceRead>) => {
		if (found.kind === 'unreadable') {
			const result = await send<ActionResult<'SITE_SOURCE_UNREADABLE'>>({
				type: 'SITE_SOURCE_UNREADABLE',
				source: source.id,
			});
			if (result?.ok && result.reported) {
				showSourceToast(
					`${appName} can't read this page anymore, so it saved nothing.`,
					{error: true},
				);
			}

			return;
		}

		const result = await send<ActionResult<'SITE_SOURCE_SAVE'>>({
			type: 'SITE_SOURCE_SAVE',
			source: source.id,
			url: found.link.url,
			title: found.link.title,
			discussion: found.link.discussion,
		});
		if (!result) {
			return;
		}

		if (!result.ok) {
			showSourceToast(result.error, {error: true});
			return;
		}

		showSaved(result);
		// Shown here, so a later page in this tab must not show it again. Taken a little later, not at once: on a
		// site whose save control loads another page, this page can get the result just before it goes, and then
		// the next page shows it; a page that has gone never takes it.
		if (source.saveLoadsPage) {
			setTimeout(() => {
				void takePending();
			}, PENDING_TAKE_DELAY_MS);
		}
	};

	// A save whose click loaded this page (Hacker News' favorite link) shows its result here.
	if (source.saveLoadsPage) {
		void takePending().then((pending) => {
			if (pending?.ok && pending.saved) {
				showSaved(pending.saved);
			}
		});
	}

	// Capture on the window sees the click before the site's own handlers change the control's state.
	globalThis.addEventListener(
		'click',
		(event) => {
			if (!event.isTrusted) {
				return;
			}

			const found = read(event);
			if (found) {
				void handle(found);
			}
		},
		{capture: true},
	);
}
