/*
Bookmark tags (#344): the kind worked out from the address (link-kind.ts) plus the tags the person typed. Only the
typed tags and the kinds the person removed are stored, on `Bookmark.tags` and `Bookmark.hiddenKinds`; the kind
itself is read again each time. Both fields sync as a `tag` record of their own (ADR 8). Shared by the extension, the
Android app, and the sync code, so nothing here may use browser or Node APIs.

Stored values are normalized the same way on every device and the result is stable, so two devices never disagree
about a record and send it back and forth.
*/
import {LINK_KINDS, linkKind, type LinkKind} from './link-kind';
import type {Bookmark} from './types';

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

/**
One tag as it is stored: lower case (the same on every device, whatever its language), spaces tidied, a leading `#`
dropped, no commas, at most `MAX_TAG_LENGTH` characters. Undefined when nothing is left.
*/
export function normalizeTag(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const tag = value
		.normalize('NFC')
		// `toLowerCase` ignores the device's language, so "I" is "i" on a Turkish phone too.
		.toLowerCase()
		.replaceAll(/[\p{Control},]/gu, ' ')
		.replace(/^[\s#]+/, '')
		.replaceAll(/\s+/g, ' ')
		.trim();
	return tag === ''
		? undefined
		: [...tag].slice(0, MAX_TAG_LENGTH).join('').trim();
}

/**
A bookmark's own tags as they are stored: each normalized, the first of equal ones kept, in the order given, at most
`MAX_TAGS`. Undefined when none are left, so a bookmark without tags stores no field.
*/
export function bookmarkTags(value: unknown): string[] | undefined {
	const tags = new Set<string>();
	for (const entry of Array.isArray(value) ? value : []) {
		const tag = normalizeTag(entry);
		if (tag && tags.size < MAX_TAGS) {
			tags.add(tag);
		}
	}

	return tags.size > 0 ? [...tags] : undefined;
}

/**
The automatic kinds the person removed from a bookmark, in the order `LINK_KINDS` lists them, or undefined when none.
*/
export function hiddenKinds(
	value: unknown,
): Array<Exclude<LinkKind, 'page'>> | undefined {
	const given = new Set(Array.isArray(value) ? value : []);
	const kinds = LINK_KINDS.filter((kind) => given.has(kind));
	return kinds.length > 0 ? kinds : undefined;
}

/**
The `tags` and `hiddenKinds` fields of a bookmark, each left out when empty.
*/
export function tagFields(raw: {
	tags?: unknown;
	hiddenKinds?: unknown;
}): Pick<Bookmark, 'tags' | 'hiddenKinds'> {
	const tags = bookmarkTags(raw.tags);
	const hidden = hiddenKinds(raw.hiddenKinds);
	return {...(tags && {tags}), ...(hidden && {hiddenKinds: hidden})};
}

/**
The bookmark with each list that `edits` gives (an array) in place of its own, normalized; a list left out stays.
*/
export function withTagEdits<T extends Pick<Bookmark, 'tags' | 'hiddenKinds'>>(
	bookmark: T,
	edits: {tags?: unknown; hiddenKinds?: unknown},
): T {
	const {tags, hiddenKinds: hidden, ...rest} = bookmark;
	return {
		...rest,
		...tagFields({
			tags: Array.isArray(edits.tags) ? edits.tags : tags,
			hiddenKinds: Array.isArray(edits.hiddenKinds)
				? edits.hiddenKinds
				: hidden,
		}),
	} as T;
}

/**
Splits what the person typed into tags: commas separate them.
*/
export function parseTagInput(text: string): string[] {
	return bookmarkTags(text.split(',')) ?? [];
}

/**
The automatic kind a bookmark shows, or undefined for a plain page or a kind the person removed.
*/
function shownKind(
	bookmark: Pick<Bookmark, 'url' | 'hiddenKinds'>,
): Exclude<LinkKind, 'page'> | undefined {
	const kind = linkKind(bookmark.url);
	return kind === 'page' || bookmark.hiddenKinds?.includes(kind)
		? undefined
		: kind;
}

/**
Every tag a bookmark shows: its kind first, then its own tags, each once.
*/
export function shownTags(
	bookmark: Pick<Bookmark, 'url' | 'tags' | 'hiddenKinds'>,
): string[] {
	const kind = shownKind(bookmark);
	const own = (bookmark.tags ?? []).filter((tag) => tag !== kind);
	return kind ? [kind, ...own] : own;
}

/**
Every tag in a list of bookmarks with how many show it, most used first, then by name.
*/
export function tagCounts(
	bookmarks: ReadonlyArray<Pick<Bookmark, 'url' | 'tags' | 'hiddenKinds'>>,
): Array<{tag: string; count: number}> {
	const counts = new Map<string, number>();
	for (const bookmark of bookmarks) {
		for (const tag of shownTags(bookmark)) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}

	return [...counts]
		.map(([tag, count]) => ({tag, count}))
		.toSorted((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
What an edit took away: own tags no longer there, and kinds newly removed, or undefined when it took nothing away, so
the caller knows whether to offer Undo. A kind that went because the address changed is not a removal.
*/
export function removedByEdit(
	before: Pick<Bookmark, 'tags' | 'hiddenKinds'>,
	after: Pick<Bookmark, 'tags' | 'hiddenKinds'>,
): string[] | undefined {
	const removed = [
		...(before.tags ?? []).filter((tag) => !after.tags?.includes(tag)),
		...(after.hiddenKinds ?? []).filter(
			(kind) => !before.hiddenKinds?.includes(kind),
		),
	];
	return removed.length > 0 ? removed : undefined;
}
