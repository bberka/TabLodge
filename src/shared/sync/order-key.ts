/*
Order keys (fractional indexes) for siblings such as sessions in a folder or bookmarks in a column. Plain string
order is list order and a new key always fits between two others, so moving an item rewrites only its own key.

The scheme is the one from rocicorp/fractional-indexing (CC0). A key is an integer part and a fraction, both in
base 62. The first character gives the integer part's length ("a" to "z" for positive integers of 1 to 26
digits, "Z" down to "A" for negative ones), so adding items at either end only increments or decrements the
integer and keys grow with the logarithm of the list length. Inserting between neighbours uses the fraction,
which never ends in "0".
*/

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0];
const LAST = DIGITS.at(-1)!;
const SMALLEST_INTEGER = 'A' + ZERO.repeat(26);
// Long enough for any real list; a key this long means something keeps inserting at one spot.
const MAX_KEY_LENGTH = 64;
const DIGITS_PATTERN = /^[\da-z]*$/i;

function integerLength(head: string): number | undefined {
	if (head >= 'a' && head <= 'z') {
		return head.codePointAt(0)! - 'a'.codePointAt(0)! + 2;
	}

	return head >= 'A' && head <= 'Z'
		? 'Z'.codePointAt(0)! - head.codePointAt(0)! + 2
		: undefined;
}

/**
The key split into its integer part and fraction, or undefined for anything that is not a key.
*/
function split(key: string): [string, string] | undefined {
	const length = integerLength(key[0] ?? '');
	if (
		length === undefined ||
		length > key.length ||
		key.length > MAX_KEY_LENGTH ||
		!DIGITS_PATTERN.test(key) ||
		key === SMALLEST_INTEGER ||
		(key.endsWith(ZERO) && key.length > length)
	) {
		return undefined;
	}

	return [key.slice(0, length), key.slice(length)];
}

export const isOrderKey = (value: unknown): value is string =>
	typeof value === 'string' && split(value) !== undefined;

const digit = (text: string, index: number) =>
	index < text.length ? DIGITS.indexOf(text[index]) : 0;

/**
A fraction strictly between two fractions; `high` undefined means 1.
*/
function midpoint(low: string, high: string | undefined): string {
	if (high !== undefined) {
		let shared = 0;
		while (shared < high.length && digit(low, shared) === digit(high, shared)) {
			shared += 1;
		}

		if (shared > 0) {
			return (
				high.slice(0, shared) + midpoint(low.slice(shared), high.slice(shared))
			);
		}
	}

	const lowDigit = digit(low, 0);
	const highDigit = high === undefined ? DIGITS.length : digit(high, 0);
	if (highDigit - lowDigit > 1) {
		return DIGITS[Math.round((lowDigit + highDigit) / 2)];
	}

	return high !== undefined && high.length > 1
		? high[0]
		: DIGITS[lowDigit] + midpoint(low.slice(1), undefined);
}

/**
The next integer part, or undefined past the largest one.
*/
function increment(integer: string): string | undefined {
	const head = integer[0];
	const digits = [...integer.slice(1)];
	for (let index = digits.length - 1; index >= 0; index -= 1) {
		const next = DIGITS.indexOf(digits[index]) + 1;
		if (next < DIGITS.length) {
			digits[index] = DIGITS[next]!;
			return head + digits.join('');
		}

		digits[index] = ZERO;
	}

	if (head === 'z') {
		return undefined;
	}

	if (head === 'Z') {
		return 'a' + ZERO;
	}

	const nextHead = String.fromCodePoint(head.codePointAt(0)! + 1);
	return (
		nextHead + (nextHead > 'a' ? [...digits, ZERO] : digits.slice(1)).join('')
	);
}

/**
The previous integer part, or undefined before the smallest one.
*/
function decrement(integer: string): string | undefined {
	const head = integer[0];
	const digits = [...integer.slice(1)];
	for (let index = digits.length - 1; index >= 0; index -= 1) {
		const previous = DIGITS.indexOf(digits[index]) - 1;
		if (previous >= 0) {
			digits[index] = DIGITS[previous]!;
			return head + digits.join('');
		}

		digits[index] = LAST;
	}

	if (head === 'A') {
		return undefined;
	}

	if (head === 'a') {
		return 'Z' + LAST;
	}

	const previousHead = String.fromCodePoint(head.codePointAt(0)! - 1);
	return (
		previousHead +
		(previousHead < 'Z' ? [...digits, LAST] : digits.slice(1)).join('')
	);
}

/**
A key that sorts after `before` and before `after`. Leave either out for the start or the end of the list.
*/
export function keyBetween(before?: string, after?: string): string {
	const low = before === undefined ? undefined : split(before);
	const high = after === undefined ? undefined : split(after);
	if ((before !== undefined && !low) || (after !== undefined && !high)) {
		throw new TypeError('Not an order key');
	}

	if (before !== undefined && after !== undefined && before >= after) {
		throw new RangeError('Order keys are out of order');
	}

	if (!low) {
		if (!high) {
			return 'a' + ZERO;
		}

		const [integer, fraction] = high;
		if (integer === SMALLEST_INTEGER) {
			return integer + midpoint('', fraction);
		}

		if (fraction !== '') {
			return integer;
		}

		const previous = decrement(integer);
		if (previous === undefined) {
			throw new RangeError('No order key before this one');
		}

		return previous;
	}

	const [integer, fraction] = low;
	if (high?.[0] === integer) {
		return integer + midpoint(fraction, high[1]);
	}

	const next = increment(integer);
	return next !== undefined && (after === undefined || next < after)
		? next
		: integer + midpoint(fraction, undefined);
}

/**
Keys for a list of `count` items in order, used when a list gets its keys for the first time.
*/
export function spreadKeys(count: number): string[] {
	const keys: string[] = [];
	for (let index = 0; index < count; index += 1) {
		keys.push(keyBetween(keys.at(-1)));
	}

	return keys;
}
