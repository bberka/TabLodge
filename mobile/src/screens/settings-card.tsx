/*
The search box's reach into the settings cards: a card hides when nothing in it matches, and a row hides when the card
matched only through that row's neighbours.
*/
import {createContext, type ReactNode, use, useMemo} from 'react';
import {Card} from '../ui';
import {
	headHit,
	type Row,
	rowHit,
	type Section,
	sectionVisible,
} from './settings-index';

const QueryContext = createContext('');
// True while the card's own name matched, which shows all of its rows.
const WholeCardContext = createContext(true);

export const SettingsQuery = QueryContext;

/**
Whether one row shows: always without a search, or when the card matched as a whole, or when the row's own text does.
*/
export function useRowVisible(row: Row): boolean {
	const query = use(QueryContext);
	const whole = use(WholeCardContext);
	return query === '' || whole || rowHit(row, query);
}

/**
A card that hides itself when the search matches nothing in it.
*/
export function SettingsCard({
	section,
	children,
}: {
	section: Section;
	children: ReactNode;
}) {
	const query = use(QueryContext);
	// A card that has no rows of its own (status and buttons) shows in full whenever it is found.
	const whole = useMemo(
		() => query === '' || headHit(section, query) || section.rows.length === 0,
		[section, query],
	);
	if (!sectionVisible(section, query)) {
		return null;
	}

	return (
		<WholeCardContext value={whole}>
			<Card>{children}</Card>
		</WholeCardContext>
	);
}
