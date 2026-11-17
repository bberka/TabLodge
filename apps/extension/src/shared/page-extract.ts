/*
Turns a page into a readable copy (page-copy.ts). Mozilla's Readability finds the article; this module walks what it
kept and writes text blocks, so no markup survives. The extension passes a clone of the open page's document; the
Android app parses fetched HTML with linkedom and passes that. Only standard DOM calls on the given document are used,
so the same code runs in both (ADR 8).
*/
import {Readability} from '@mozilla/readability';
import type {CopyBlock, CopyBlockType, PageCopy} from './page-copy';

const ELEMENT = 1;
const TEXT = 3;
// Never text a reader wants. Readability drops most of these, but the fallback below walks the raw body.
const SKIPPED = new Set([
	'script',
	'style',
	'noscript',
	'template',
	'svg',
	'canvas',
	'iframe',
	'object',
	'embed',
	'video',
	'audio',
	'picture',
	'img',
	'button',
	'select',
	'input',
	'textarea',
	'form',
	'head',
]);
// Page furniture, skipped only when Readability found no article and the whole body is read.
const CHROME = new Set(['nav', 'header', 'footer', 'aside', 'menu', 'dialog']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCKS = new Set([
	...HEADINGS,
	'p',
	'li',
	'ul',
	'ol',
	'dl',
	'dt',
	'dd',
	'blockquote',
	'pre',
	'table',
	'tr',
	'div',
	'section',
	'article',
	'main',
	'figure',
	'figcaption',
	'hr',
	'details',
	'summary',
	'address',
	...CHROME,
]);

const nameOf = (node: Node) =>
	node.nodeType === ELEMENT ? (node as Element).localName.toLowerCase() : '';

const tidy = (text: string) => text.replaceAll(/\s+/g, ' ').trim();

/**
The text of an element that holds no blocks of its own, with line breaks kept.
*/
function inlineText(node: Node, skip: ReadonlySet<string>): string {
	if (node.nodeType === TEXT) {
		return node.textContent ?? '';
	}

	const name = nameOf(node);
	if (name === 'br') {
		return '\n';
	}

	if (node.nodeType !== ELEMENT || skip.has(name)) {
		return '';
	}

	let text = '';
	for (const child of node.childNodes) {
		text += inlineText(child, skip);
	}

	return text;
}

const lines = (text: string) =>
	text
		.split('\n')
		.map((line) => tidy(line))
		.filter(Boolean)
		.join('\n');

function hasBlocks(node: Node): boolean {
	for (const child of node.childNodes) {
		if (BLOCKS.has(nameOf(child)) || hasBlocks(child)) {
			return true;
		}
	}

	return false;
}

function walk(root: Node, skip: ReadonlySet<string>): CopyBlock[] {
	const blocks: CopyBlock[] = [];
	let pending = '';
	const push = (type: CopyBlockType, text: string) => {
		const clean =
			type === 'code' ? text.replaceAll(/^\n+|\s+$/g, '') : lines(text);
		if (clean !== '') {
			blocks.push({type, text: clean});
		}
	};

	const flush = () => {
		push('paragraph', pending);
		pending = '';
	};

	const visit = (node: Node) => {
		const name = nameOf(node);
		if (node.nodeType === TEXT) {
			pending += node.textContent ?? '';
			return;
		}

		if (node.nodeType !== ELEMENT || skip.has(name)) {
			return;
		}

		if (!BLOCKS.has(name) && !hasBlocks(node)) {
			pending += inlineText(node, skip);
			return;
		}

		flush();
		if (HEADINGS.has(name)) {
			push('heading', inlineText(node, skip));
		} else if (name === 'pre') {
			push('code', node.textContent ?? '');
		} else if (name === 'blockquote' && !hasBlocks(node)) {
			push('quote', inlineText(node, skip));
		} else {
			switch (name) {
				case 'blockquote': {
					for (const block of walk(node, skip)) {
						blocks.push(
							block.type === 'paragraph' ? {...block, type: 'quote'} : block,
						);
					}

					break;
				}

				case 'li':
				case 'dt':
				case 'dd': {
					// The item's own words, then any list nested in it as items of their own.
					let own = '';
					const nested: Node[] = [];
					for (const child of node.childNodes) {
						if (BLOCKS.has(nameOf(child))) {
							nested.push(child);
						} else {
							own += inlineText(child, skip);
						}
					}

					push('item', own);
					for (const child of nested) {
						visit(child);
					}

					break;
				}

				case 'tr': {
					const cells = [...node.childNodes]
						.map((cell) => tidy(inlineText(cell, skip)))
						.filter(Boolean);
					push('paragraph', cells.join(' · '));

					break;
				}

				default: {
					if (hasBlocks(node)) {
						for (const child of node.childNodes) {
							visit(child);
						}
					} else {
						push('paragraph', inlineText(node, skip));
					}
				}
			}
		}

		flush();
	};

	visit(root);
	flush();
	return blocks;
}

/**
The readable copy of a page. `document` is changed while reading, so pass a clone or a freshly parsed one. A copy
with no blocks means the page had no text to keep.
*/
export function extractPageCopy(
	document: Document,
	url: string,
	savedAt = Date.now(),
): PageCopy {
	const pageTitle = tidy(document.title ?? '');
	let article: ReturnType<Readability<Node>['parse']> = null;
	try {
		article = new Readability<Node>(document, {
			serializer: (node) => node,
		}).parse();
	} catch {
		// A page Readability cannot read still has a body to fall back on.
	}

	const found = article?.content;
	const blocks = found
		? walk(found, SKIPPED)
		: document.body
			? walk(document.body, new Set([...SKIPPED, ...CHROME]))
			: [];
	const title = tidy(article?.title ?? '') || pageTitle || url;
	// The reader shows the title above the text, so a first heading that repeats it goes.
	if (blocks[0]?.type === 'heading' && blocks[0].text === title) {
		blocks.shift();
	}

	const byline = tidy(article?.byline ?? '');
	return {
		v: 1,
		url,
		title: title.slice(0, 300),
		...(byline && {byline: byline.slice(0, 200)}),
		savedAt,
		blocks,
	};
}
