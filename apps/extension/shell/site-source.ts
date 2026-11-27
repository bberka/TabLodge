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
import {UNDO_OFFER_MS} from '../src/shared/undo-policy';
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
const SAVED_PAGES: Partial<Record<SiteSourceId, SavedPageReader>> = {
	youtube: readYoutubeSavedPage,
	reddit: readRedditSavedPage,
	x: readTwitterSavedPage,
	instagram: readInstagramSavedPage,
	github: readGithubSavedPage,
};
const source = siteSourceForUrl(location.href);

if (source && !Object.hasOwn(globalThis, LOADED)) {
	Object.defineProperty(globalThis, LOADED, {value: true});
	const appName = chrome.runtime.getManifest().short_name ?? 'TabLodge';
	const siteName = source.column.name;
	const read = READERS[source.id]();
	let keepOffSite = false;

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

	const undoButton = (id: string) => ({
		label: 'Undo',
		expiresMs: UNDO_OFFER_MS,
		run: async () => undo(id),
	});

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
				actions: undoId ? [undoButton(undoId)] : [],
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

	const handleKept = async (kept: KeptSave) => {
		const result = await send<ActionResult<'SITE_SOURCE_SAVE'>>({
			type: 'SITE_SOURCE_SAVE',
			source: source.id,
			url: kept.link.url,
			title: kept.link.title,
			discussion: kept.link.discussion,
		});
		if (source.saveLoadsPage) {
			void takePending();
		}

		const {text, error, alsoSave, undoId} = settleKeptSave(result, kept, {
			app: appName,
			site: siteName,
		});
		showSourceToast(text, {
			error,
			actions: [
				...(undoId ? [undoButton(undoId)] : []),
				...(alsoSave ? [alsoSaveAction(kept)] : []),
			],
		});
	};

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
		if (source.saveLoadsPage) {
			setTimeout(() => {
				void takePending();
			}, PENDING_TAKE_DELAY_MS);
		}
	};

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
		keepOff: () => keepOffSite && Boolean(chrome.runtime?.id),
		onRead(found, kept) {
			void (kept ? handleKept(kept) : handle(found));
		},
	});
}
