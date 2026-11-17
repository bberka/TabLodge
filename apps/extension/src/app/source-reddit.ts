// Reddit saved: notices the user clicking Save on a post or a comment.
//   - www.reddit.com: Save in a post's or comment's overflow menu. Posts and comments are <shreddit-post> and
//     <shreddit-comment> elements carrying their permalink. A saved item's menu says "Remove from saved" instead.
//   - old.reddit.com: the "save" link of a .thing, which turns to "unsave" once saved.
// The new interface is found by the English "Save" label; the old one by its markup.
import {redditPermalinkUrl} from './site-sources';
import {
	controlLabel,
	rememberLast,
	eventElements,
	squash,
	type SourceLink,
	type SourceReader,
} from './source-reader';

const NEW_ITEM = 'shreddit-post, shreddit-comment';
// Where a new interface Save sits: an item's overflow menu or action row, or a menu opened from one.
const NEW_MENU =
	'shreddit-post-overflow-menu, shreddit-overflow-menu, shreddit-comment-action-row, [role="menu"]';
const CONTROL =
	'button, a, li, [role="menuitem"], [role="button"], faceplate-menu-item';

function newItemLink(item: Element): SourceLink | undefined {
	const url = redditPermalinkUrl(item.getAttribute('permalink') ?? '');
	if (!url) {
		return undefined;
	}

	const author = squash(item.getAttribute('author'));
	const title =
		item.localName === 'shreddit-post'
			? squash(item.getAttribute('post-title'))
			: author
				? `Comment by u/${author}`
				: '';
	return {url, title};
}

function oldThingLink(thing: Element): SourceLink | undefined {
	const url = redditPermalinkUrl(
		(thing as HTMLElement).dataset.permalink ?? '',
	);
	if (!url) {
		return undefined;
	}

	const author = squash((thing as HTMLElement).dataset.author);
	const title = thing.classList.contains('comment')
		? author
			? `Comment by u/${author}`
			: ''
		: squash(thing.querySelector('a.title')?.textContent);
	return {url, title};
}

export function createRedditReader(now = () => Date.now()): SourceReader {
	// The post or comment whose overflow menu is open, for a menu Reddit draws outside the item.
	const lastItem = rememberLast<SourceLink | undefined>(now);
	return (event) => {
		const path = eventElements(event);
		const saveButton = path.find((element) => element.matches('.save-button'));
		if (saveButton) {
			if (!/^save$/i.test(controlLabel(saveButton))) {
				return undefined;
			}

			const thing = path.find((element) => element.matches('.thing'));
			const link = thing ? oldThingLink(thing) : undefined;
			return link ? {kind: 'save', link} : {kind: 'unreadable'};
		}

		const item = path.find((element) => element.matches(NEW_ITEM));
		const control = path.find((element) => element.matches(CONTROL));
		if (
			control &&
			/^save$/i.test(controlLabel(control)) &&
			path.some((element) => element.matches(NEW_MENU))
		) {
			const link = item ? newItemLink(item) : lastItem.get();
			return link ? {kind: 'save', link} : {kind: 'unreadable'};
		}

		if (item) {
			lastItem.set(newItemLink(item));
		}

		return undefined;
	};
}
