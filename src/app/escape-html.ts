const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

/**
Text safe to put in HTML content or a quoted attribute.
*/
export const escapeHtml = (value: unknown) =>
	String(value ?? '').replaceAll(/["&'<>]/g, (char) => ESCAPES[char]);
