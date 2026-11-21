export const TAB_WINDOW = 100;

export const visibleTabCount = (asked: number, total: number): number =>
	Math.min(Math.max(asked, TAB_WINDOW), total);

export const nextTabWindow = (shown: number): number => shown + TAB_WINDOW;
