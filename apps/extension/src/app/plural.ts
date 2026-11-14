/**
"1 tab", "2 tabs": a count with its noun, `many` when the plural is not just an added "s".
*/
export const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;
