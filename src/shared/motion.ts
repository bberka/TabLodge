/**
Scroll behavior for script-driven scrolling: smooth, unless the user asked for reduced motion
(the CSS `scroll-behavior` rule does not affect `scrollIntoView({behavior: 'smooth'})`).
*/
export const scrollBehavior = (): ScrollBehavior =>
	globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
		? 'auto'
		: 'smooth';
