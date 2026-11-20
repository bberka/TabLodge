// The content script of Settings › Sources, registered for a site only while the user has it on and the browser
// grants the site's optional host permission. It reads the page when the user clicks, and when the click was the
// site's own save, it hands that link to the service worker and shows the result in the page. On the site's own
// saved page it also reads the list there and offers to add what TabLodge lacks (#377). It changes nothing on the
// site, except on a site the user set to Save to TabLodge only: there it stops that one click so the site does not
// save it (src/app/source-keep-off.ts). It never makes a request of its own.
import {
	SITE_SOURCES_KEY,
	siteSourceForUrl,
	type SiteSourceId,
} from '../src/app/site-sources';
import {PRIVATE_CONFIG_KEY} from '../src/app/private-config';
import {
	listenForSaves,
	settleKeptSave,
	type KeptSave,
} from '../src/app/source-keep-off';
import type {SourceRead, SourceReader} from '../src/app/source-reader';
import {createBlueskyReader} from '../src/app/source-bluesky';
import {createDevtoReader} from '../src/app/source-devto';
import {
	createGithubReader,
	readGithubSavedPage,
} from '../src/app/source-github';
import {createGoodreadsReader} from '../src/app/source-goodreads';
import {createHackerNewsReader} from '../src/app/source-hackernews';
import {createImdbReader} from '../src/app/source-imdb';
import {
	createInstagramReader,
	readInstagramSavedPage,
} from '../src/app/source-instagram';
import {createLetterboxdReader} from '../src/app/source-letterboxd';
import {createLobstersReader} from '../src/app/source-lobsters';
import {createMediumReader} from '../src/app/source-medium';
import {createSoundcloudReader} from '../src/app/source-soundcloud';
import {createSpotifyReader} from '../src/app/source-spotify';
import {createStackOverflowReader} from '../src/app/source-stackoverflow';
import {createSubstackReader} from '../src/app/source-substack';
import {createTwitterReader, readTwitterSavedPage} from '../src/app/source-x';
import {
	createYoutubeReader,
	readYoutubeSavedPage,
} from '../src/app/source-youtube';
import type {SavedPageReader} from '../src/app/source-catch-up';
import {watchSavedPage} from '../src/app/source-catch-up-page';
import {
	createRedditReader,
	readRedditSavedPage,
} from '../src/app/source-reddit';
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
	bluesky: () => createBlueskyReader(document),
	soundcloud: () => createSoundcloudReader(document),
	spotify: () => createSpotifyReader(document),
	letterboxd: () => createLetterboxdReader(document),
	imdb: () => createImdbReader(document),
	goodreads: () => createGoodreadsReader(document),
	medium: () => createMediumReader(document),
	substack: () => createSubstackReader(document),
};
// Sites whose saved page lists the user's saves in a form that can be read reliably (#377, #383).
const SAVED_PAGES: Partial<Record<SiteSourceId, SavedPageReader>> = {
	youtube: readYoutubeSavedPage,
	reddit: readRedditSavedPage,
	x: readTwitterSavedPage,
	instagram: readInstagramSavedPage,
	github: readGithubSavedPage,
};
const source = siteSourceForUrl(location.href);

// Settings injects the script into open tabs when a site is switched on, so a second copy must stay quiet.
if (source && !Object.hasOwn(globalThis, LOADED)) {
	Object.defineProperty(globalThis, LOADED, {value: true});
	const appName = chrome.runtime.getManifest().short_name ?? 'TabLodge';
	const siteName = source.column.name;
	const read = READERS[source.id]();
	// Off until the worker says otherwise, so a click before its answer reaches the site.
	let keepOffSite = false;

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
				actions: undoId ? [{label: 'Undo', run: async () => undo(undoId)}] : [],
			});
		}
	};

	const alsoSaveAction = (kept: KeptSave) => ({
		label: `Also save on ${siteName}`,
		run: async () =>
			kept.replay()
				? `Saved on ${siteName} too.`
				: `${siteName} closed that control, so it did not save this. Shift-click its save to save it there.`,
	});

	// Save to TabLodge only: the site never saw the click. When the link cannot be saved here, the click goes on to
	// the site after all, so the user's save is never lost.
	const handleKept = async (kept: KeptSave) => {
		const result = await send<ActionResult<'SITE_SOURCE_SAVE'>>({
			type: 'SITE_SOURCE_SAVE',
			source: source.id,
			url: kept.link.url,
			title: kept.link.title,
			discussion: kept.link.discussion,
		});
		const {text, error, alsoSave, undoId} = settleKeptSave(result, kept, {
			app: appName,
			site: siteName,
		});
		showSourceToast(text, {
			error,
			actions: [
				...(undoId ? [{label: 'Undo', run: async () => undo(undoId)}] : []),
				...(alsoSave ? [alsoSaveAction(kept)] : []),
			],
		});
	};

	// Clicks pass through while a refresh is out, and only the newest answer counts, so an older one that arrives
	// late cannot switch it back on.
	let modeRequest = 0;
	const readMode = async () => {
		const request = ++modeRequest;
		keepOffSite = false;
		const result = await send<ActionResult<'SITE_SOURCE_MODE'>>({
			type: 'SITE_SOURCE_MODE',
			source: source.id,
		});
		if (request === modeRequest) {
			keepOffSite = result?.ok === true && result.keepOffSite;
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
				// Under Save to TabLodge only the click was let through, so the site saved it.
				showSourceToast(
					keepOffSite
						? `${appName} can't read this page anymore, so ${siteName} saved it and ${appName} did not.`
						: `${appName} can't read this page anymore, so it saved nothing.`,
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

	const readSaved = SAVED_PAGES[source.id];
	const savedPage = readSaved
		? watchSavedPage({source, read: readSaved, send, appName, undo})
		: undefined;

	void readMode();
	// The choice in Settings, and a private window's library choice, can change while the page is open.
	chrome.storage.onChanged.addListener((changes, area) => {
		if (!(
			area === 'local' &&
			(Object.hasOwn(changes, SITE_SOURCES_KEY) ||
				Object.hasOwn(changes, PRIVATE_CONFIG_KEY))
		)) {
			return;
		}

		void readMode();
		savedPage?.refresh();
	});

	listenForSaves(globalThis, {
		read,
		// A script left behind by an extension update or removal has no runtime id and can't save, so it never stops a
		// click.
		keepOff: () => keepOffSite && Boolean(chrome.runtime?.id),
		onRead(found, kept) {
			void (kept ? handleKept(kept) : handle(found));
		},
	});
}
