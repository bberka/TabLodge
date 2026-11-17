/*
What a saved address points to, read from the address alone. It is worked out each time a row is drawn and never
stored, so old libraries and older apps need nothing. The extension and the Android app both draw it.
*/

export type LinkKind = 'image' | 'pdf' | 'video' | 'page';

const EXTENSION_KINDS: Readonly<Record<string, LinkKind>> = {
	jpg: 'image',
	jpeg: 'image',
	png: 'image',
	gif: 'image',
	webp: 'image',
	avif: 'image',
	svg: 'image',
	bmp: 'image',
	pdf: 'pdf',
	mp4: 'video',
	m4v: 'video',
	webm: 'video',
	mov: 'video',
	mkv: 'video',
	ogv: 'video',
};

/**
Sites whose addresses are videos when the path matches, keyed by host without "www." and "m.".
*/
const VIDEO_PATHS: Readonly<Record<string, RegExp>> = {
	'youtube.com': /^\/(?:watch|shorts\/|embed\/|live\/)/,
	'youtu.be': /^\/[\w-]+/,
	'vimeo.com': /^\/\d+/,
	'dailymotion.com': /^\/video\//,
	'twitch.tv': /^\/videos\//,
};

/**
Sites that serve PDFs at addresses without a .pdf ending.
*/
const PDF_PATHS: Readonly<Record<string, RegExp>> = {
	'arxiv.org': /^\/pdf\//,
};

export function linkKind(address: string): LinkKind {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return 'page';
	}

	// Data and blob addresses are never saved, and say nothing a name could be read from.
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return 'page';
	}

	const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
	if (VIDEO_PATHS[host]?.test(url.pathname)) {
		return 'video';
	}

	if (PDF_PATHS[host]?.test(url.pathname)) {
		return 'pdf';
	}

	// Only the last path segment counts: a query such as ?file=photo.jpg belongs to a page.
	const name = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0
		? (EXTENSION_KINDS[name.slice(dot + 1).toLowerCase()] ?? 'page')
		: 'page';
}

/**
The word a screen reader says for a kind, or nothing for a page.
*/
export const LINK_KIND_LABELS: Readonly<Record<LinkKind, string>> = {
	image: 'Image',
	pdf: 'PDF',
	video: 'Video',
	page: '',
};
