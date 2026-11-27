const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

export const escapeHtml = (value: unknown) =>
	String(value ?? '').replaceAll(/["&'<>]/g, (char) => ESCAPES[char]);
