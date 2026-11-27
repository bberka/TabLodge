export type DeleteQuestion = {title: string; description: string};

const NAME_MAX = 80;
const UNDO = 'You can undo this right after.';

const quoted = (name: string) =>
	`“${name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name}”`;

const counted = (count: number, noun: string) =>
	`${count} ${noun}${count === 1 ? '' : 's'}`;

export function bookmarkDeleteQuestion(
	bookmarks: ReadonlyArray<{title: string; url: string}>,
): DeleteQuestion {
	const [first] = bookmarks;
	return {
		title:
			bookmarks.length === 1 && first
				? `Delete bookmark ${quoted(first.title || first.url)}?`
				: `Delete ${counted(bookmarks.length, 'bookmark')}?`,
		description: UNDO,
	};
}

export function sessionDeleteQuestion(
	sessions: ReadonlyArray<{name: string; tabs: readonly unknown[]}>,
): DeleteQuestion {
	const [first] = sessions;
	const single = sessions.length === 1 && first;
	const links = sessions.reduce((sum, session) => sum + session.tabs.length, 0);
	return {
		title: single
			? `Delete session ${quoted(first.name)}?`
			: `Delete ${counted(sessions.length, 'session')}?`,
		description: `${single ? 'It has' : 'They have'} ${counted(links, 'link')}. ${UNDO}`,
	};
}

export function columnDeleteQuestion(
	name: string,
	count: number,
	moveTo?: string,
): DeleteQuestion {
	const bookmarks =
		count === 0
			? 'It has no bookmarks.'
			: `Its ${counted(count, 'bookmark')} ${count === 1 ? 'moves' : 'move'} to ${moveTo === undefined ? 'Unfiled' : quoted(moveTo)}.`;
	return {
		title: `Delete column ${quoted(name)}?`,
		description: `${bookmarks} ${UNDO}`,
	};
}
