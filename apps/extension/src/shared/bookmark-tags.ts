import {LINK_KINDS, linkKind, type LinkKind} from './link-kind';
import type {Bookmark} from './types';

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

export function normalizeTag(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const tag = value
		.normalize('NFC')
		.toLowerCase()
		.replaceAll(/[\p{Control}",|“”„]/gu, ' ')
		.replace(/^[\s#]+/, '')
		.replaceAll(/\s+/g, ' ')
		.trim();
	return tag === ''
		? undefined
		: [...tag].slice(0, MAX_TAG_LENGTH).join('').trim();
}

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

export function hiddenKinds(
	value: unknown,
): Array<Exclude<LinkKind, 'page'>> | undefined {
	const given = new Set(Array.isArray(value) ? value : []);
	const kinds = LINK_KINDS.filter((kind) => given.has(kind));
	return kinds.length > 0 ? kinds : undefined;
}

export function tagFields(raw: {
	tags?: unknown;
	hiddenKinds?: unknown;
}): Pick<Bookmark, 'tags' | 'hiddenKinds'> {
	const tags = bookmarkTags(raw.tags);
	const hidden = hiddenKinds(raw.hiddenKinds);
	return {...(tags && {tags}), ...(hidden && {hiddenKinds: hidden})};
}

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

export function parseTagInput(text: string): string[] {
	return bookmarkTags(text.split(',')) ?? [];
}

function shownKind(
	bookmark: Pick<Bookmark, 'url' | 'hiddenKinds'>,
): Exclude<LinkKind, 'page'> | undefined {
	const kind = linkKind(bookmark.url);
	return kind === 'page' || bookmark.hiddenKinds?.includes(kind)
		? undefined
		: kind;
}

export function shownTags(
	bookmark: Pick<Bookmark, 'url' | 'tags' | 'hiddenKinds'>,
): string[] {
	const kind = shownKind(bookmark);
	const own = (bookmark.tags ?? []).filter((tag) => tag !== kind);
	return kind ? [kind, ...own] : own;
}

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
