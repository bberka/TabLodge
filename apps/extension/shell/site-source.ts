// The content script of Settings › Sources, registered for a site only while the user has it on and the browser
// grants the site's optional host permission. It only observes: it reads the page when the user clicks, and when
// the click was the site's own save, it hands that link to the service worker and shows the result in the page.
// It never changes the site's behavior, blocks its save, or makes a request of its own.
import {siteSourceForUrl, type SiteSourceId} from '../src/app/site-sources';
import type {SourceRead, SourceReader} from '../src/app/source-reader';
import {createInstagramReader} from '../src/app/source-instagram';
import {createRedditReader} from '../src/app/source-reddit';
import {createTwitterReader} from '../src/app/source-x';
import {createYoutubeReader} from '../src/app/source-youtube';
import {showSourceToast} from '../src/app/source-toast';
import type {ActionResult, SiteSourceOutcome} from '../src/shared/types';

const LOADED = 'tablodgeSiteSource';
const READERS: Record<SiteSourceId, () => SourceReader> = {
	youtube: () => createYoutubeReader(document),
	reddit: () => createRedditReader(),
	x: () => createTwitterReader(document),
	instagram: () => createInstagramReader(document),
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

	const handle = async (found: NonNullable<SourceRead>) => {
		if (found.kind === 'unreadable') {
			const result = await send<ActionResult<'SITE_SOURCE_UNREADABLE'>>({
				type: 'SITE_SOURCE_UNREADABLE',
				source: source.id,
			});
			if (result?.ok && result.reported) {
				showSourceToast(
					`${appName} can't read this page anymore, so it saved nothing.`,
				);
			}

			return;
		}

		const result = await send<ActionResult<'SITE_SOURCE_SAVE'>>({
			type: 'SITE_SOURCE_SAVE',
			source: source.id,
			url: found.link.url,
			title: found.link.title,
		});
		if (!result) {
			return;
		}

		if (!result.ok) {
			showSourceToast(result.error);
			return;
		}

		const messages: Record<SiteSourceOutcome, string | undefined> = {
			saved: `Saved to ${appName} in ${result.column}.`,
			exists: `Already in ${appName}.`,
			trashed: `In the ${appName} trash bin, so not saved again.`,
			off: undefined,
		};
		const text = messages[result.outcome];
		if (!text) {
			return;
		}

		const {undoId} = result;
		showSourceToast(
			text,
			undoId ? {label: 'Undo', run: async () => undo(undoId)} : undefined,
		);
	};

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
