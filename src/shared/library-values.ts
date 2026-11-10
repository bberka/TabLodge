/*
Small value helpers shared by the library storage modules.
*/

export type Raw = Record<string, unknown>;

export const isRecord = (value: unknown): value is Raw =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
A short non-cryptographic hash (cyrb53) used to spot a record, snapshot, or backup identical to a previous one.
*/
/* eslint-disable no-bitwise -- a hash is bit arithmetic */
// A local binding: inside a worker sandbox a global `Math.imul` lookup per character is far slower than the loop itself.
const {imul} = Math;
export function hashText(text: string): string {
	let h1 = 0xde_ad_be_ef ^ text.length;
	let h2 = 0x41_c6_ce_57 ^ text.length;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.codePointAt(index)!;
		h1 = imul(h1 ^ code, 2_654_435_761);
		h2 = imul(h2 ^ code, 1_597_334_677);
	}

	h1 =
		imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^
		imul(h2 ^ (h2 >>> 13), 3_266_489_909);
	h2 =
		imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^
		imul(h1 ^ (h1 >>> 13), 3_266_489_909);
	return (
		(4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0)).toString(36) +
		text.length.toString(36)
	);
}

/* eslint-enable no-bitwise */

/**
JSON with object keys in sorted order. `chrome.storage` hands objects back with their keys sorted, so a record
read back would otherwise serialize differently from the one that was written, and every checksum would fail.
*/
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null';
	}

	if (Array.isArray(value)) {
		let out = '[';
		for (const [index, item] of value.entries()) {
			out += `${index > 0 ? ',' : ''}${canonicalJson(item)}`;
		}

		return `${out}]`;
	}

	const record = value as Raw;
	let out = '{';
	let first = true;
	for (const key of Object.keys(record).toSorted()) {
		const item = record[key];
		if (item === undefined || typeof item === 'function') {
			continue;
		}

		out += `${first ? '' : ','}${JSON.stringify(key)}:${canonicalJson(item)}`;
		first = false;
	}

	return `${out}}`;
}

export const isCount = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
