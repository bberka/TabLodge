export const scrollBehavior = (): ScrollBehavior =>
	globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
		? 'auto'
		: 'smooth';
