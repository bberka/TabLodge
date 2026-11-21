export type CommentKind = 'line' | 'block' | 'shebang';

const ESLINT_DISABLE = /^\s*eslint-disable(?:-next-line|-line)?(?=\s|$)/;
const ESLINT_REASON = /\s--\s+\S/;
const TS_DIRECTIVE = /^\s*@ts-(?:expect-error|ignore)(?=\s|$)/;
const TS_REASON = /^\s*@ts-(?:expect-error|ignore)\s+\S/;

export function isAllowedComment(kind: CommentKind, value: string): boolean {
	if (
		kind === 'shebang' ||
		(kind === 'line' && value.startsWith('/ <reference ')) ||
		/^\s*eslint-enable(?=\s|$)/.test(value)
	) {
		return true;
	}

	if (ESLINT_DISABLE.test(value)) {
		return ESLINT_REASON.test(value);
	}

	return TS_DIRECTIVE.test(value) ? TS_REASON.test(value) : false;
}

export const BANNED_COMMENT_MESSAGE =
	'Code comments are banned: they rot and nothing checks them. Put the reason in a name, a type, a test, or an ADR (docs/adr/). Lint and type directives stay, with the reason inside: `eslint-disable-next-line rule -- reason`, `@ts-expect-error reason`.';
