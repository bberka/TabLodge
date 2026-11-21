/*
How many of a session's links an expanded card draws. A session can hold thousands of links, and each drawn link is a
swipeable row, so the card draws a window and a button adds the next one.
*/
export const TAB_WINDOW = 100;

/**
The number of links to draw after the user asked for `asked` of `total`: never more than there are.
*/
export const visibleTabCount = (asked: number, total: number): number =>
	Math.min(Math.max(asked, TAB_WINDOW), total);

/**
The window after one more press of the button.
*/
export const nextTabWindow = (shown: number): number => shown + TAB_WINDOW;
