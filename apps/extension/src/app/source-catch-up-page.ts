import type {ActionResult} from '../shared/types';
import {UNDO_OFFER_MS} from '../shared/undo-policy';
import {
	CATCH_UP_MAX_LINKS,
	catchUpCountText,
	type SavedPageReader,
} from './source-catch-up';
import type {SiteSource} from './site-sources';
import type {SourceLink} from './source-reader';
import {showSourceToast, type ToastAction} from './source-toast';

const READ_EVERY_MS = 1000;
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
	let lastAsked = '';
	let latestRequest = 0;
	let visit = 0;
	let asked = false;
	let failures = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const add = async (links: SourceLink[], automatic = false) => {
		const unseen = automatic && document.hidden;
		const result = await send<ActionResult<'SITE_SOURCE_CATCH_UP_ADD'>>({
			type: 'SITE_SOURCE_CATCH_UP_ADD',
			source: source.id,
			links,
			...(automatic && {automatic: true}),
			...(unseen && {unseen: true}),
		});
		if (!result) {
			return `${appName} could not add them.`;
		}

		if (!result.ok) {
			return result.error;
		}

		const {added, column, undoId} = result;
		if (automatic && added === 0) {
			return undefined;
		}

		const text =
			added === 0
				? `Nothing to add: they're in ${appName} already.`
				: `Added ${added} to ${appName} in ${column}.`;
		return undoId
			? {
					text,
					action: {
						label: 'Undo',
						expiresMs: UNDO_OFFER_MS,
						...(unseen && {
							async onFirstSeen() {
								await send({type: 'SITE_SOURCE_UNDO_SEEN', id: undoId});
							},
						}),
						run: async () => undo(undoId),
					},
				}
			: text;
	};

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
		if (!loaded) {
			latestRequest++;
			visit++;
			lastAsked = '';
			asked = false;
			return;
		}

		const links = loaded.slice(0, CATCH_UP_MAX_LINKS);
		if (links.length === 0) {
			lastAsked = '';
			return;
		}

		const key = links
			.map((link) => link.url)
			.toSorted()
			.join('\n');
		if (key === lastAsked) {
			return;
		}

		lastAsked = key;
		const request = ++latestRequest;
		const here = visit;
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

		if (result.mode === 'add') {
			const next = await add(links, true);
			if (visit !== here || !next) {
				return;
			}

			const step = typeof next === 'string' ? {text: next} : next;
			showSourceToast(step.text, {
				actions: 'action' in step ? [step.action] : [],
			});
			return;
		}

		if (asked) {
			return;
		}

		asked = true;
		const cut =
			loaded.length > links.length
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
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) {
			settle();
		}
	});
	settle();
	return {
		refresh() {
			lastAsked = '';
			latestRequest++;
			visit++;
			asked = false;
			settle();
		},
	};
}
