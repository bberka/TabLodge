import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {type CommentKind, isAllowedComment} from './comment-policy.ts';

const BASELINE = 'scripts/comment-baseline.json';
const SOURCE = /\.[cm]?[jt]sx?$/;
const GENERATED = new Set(['apps/server/cloudflare-deploy/worker.js']);

export type Baseline = Record<string, number>;

export type Comment = {
	line: number;
	kind: CommentKind;
	text: string;
	allowed: boolean;
};

export function isCounted(path: string): boolean {
	return SOURCE.test(path) && !GENERATED.has(path);
}

export function scanComments(path: string, text: string): Comment[] {
	const source = ts.createSourceFile(
		path,
		text,
		ts.ScriptTarget.Latest,
		true,
		path.endsWith('x') ? ts.ScriptKind.TSX : undefined,
	);
	const seen = new Set<number>();
	const found: Comment[] = [];
	const collect = (node: ts.Node) => {
		const ranges = [
			...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
			...(ts.getTrailingCommentRanges(text, node.end) ?? []),
		];
		for (const range of ranges) {
			if (seen.has(range.pos)) {
				continue;
			}

			seen.add(range.pos);
			const raw = text.slice(range.pos, range.end);
			const kind: CommentKind = raw.startsWith('#!')
				? 'shebang'
				: raw.startsWith('//')
					? 'line'
					: 'block';
			const value = kind === 'block' ? raw.slice(2, -2) : raw.slice(2);
			found.push({
				line: source.getLineAndCharacterOfPosition(range.pos).line + 1,
				kind,
				text: raw,
				allowed: isAllowedComment(kind, value),
			});
		}
	};

	const walk = (node: ts.Node) => {
		const children = node.getChildren(source);
		if (children.length === 0) {
			collect(node);
		} else {
			for (const child of children) {
				walk(child);
			}
		}
	};

	walk(source);
	return found.toSorted((a, b) => a.line - b.line);
}

export function countComments(path: string, text: string): number {
	return scanComments(path, text).filter((comment) => !comment.allowed).length;
}

type Verdict = {path: string; problem: string};

export function judge(
	path: string,
	count: number,
	baseline: number | undefined,
	base: number | undefined,
): Verdict | undefined {
	if (count > (base ?? 0)) {
		return {
			path,
			problem: `${count} comments, ${base ?? 0} at the base: this branch adds ${count - (base ?? 0)}. Delete them; the reason goes in a name, a type, a test, or an ADR.`,
		};
	}

	const allowed = baseline ?? 0;
	if (count !== allowed) {
		return {
			path,
			problem: `${count} comments but the baseline says ${allowed}. Run \`node scripts/comment-ratchet.ts --write\` and commit ${BASELINE}.`,
		};
	}

	return undefined;
}

function git(...args: string[]): string {
	return execFileSync('git', args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 256 * 1024 * 1024,
	}).trim();
}

function readBaseline(): Baseline {
	return existsSync(BASELINE)
		? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline)
		: {};
}

export function formatBaseline(baseline: Baseline): string {
	const entries = Object.entries(baseline).toSorted(([a], [b]) =>
		a.localeCompare(b, 'en'),
	);
	return entries.length === 0
		? '{}\n'
		: `{\n${entries.map(([path, count]) => `\t${JSON.stringify(path)}: ${count}`).join(',\n')}\n}\n`;
}

function resolveBase(args: string[]): string | undefined {
	const flag = args.indexOf('--base');
	if (flag !== -1) {
		return args[flag + 1];
	}

	try {
		return git('merge-base', 'HEAD', 'origin/master');
	} catch {
		return undefined;
	}
}

function touchedFiles(base: string): string[] {
	const changed = git('diff', '--name-only', base).split('\n');
	const untracked = git('ls-files', '--others', '--exclude-standard').split(
		'\n',
	);
	return [...new Set([...changed, ...untracked])].filter(
		(path) => path !== '' && isCounted(path),
	);
}

function countAtBase(base: string, path: string): number | undefined {
	try {
		return countComments(path, git('show', `${base}:${path}`));
	} catch {
		return undefined;
	}
}

export function area(path: string): string {
	if (path.startsWith('apps/server/')) {
		return 'server';
	}

	if (path.startsWith('apps/extension/src/shared/')) {
		return 'shared';
	}

	if (path.startsWith('apps/extension/shell/')) {
		return 'shell';
	}

	if (path.startsWith('apps/mobile/')) {
		return 'mobile';
	}

	if (path.startsWith('apps/site/')) {
		return 'site';
	}

	if (
		path.startsWith('apps/extension/src/') ||
		path.startsWith('apps/extension/tests/')
	) {
		return 'extension';
	}

	return 'scripts';
}

function report(): number {
	const totals = new Map<
		string,
		{files: number; comments: number; lines: number}
	>();
	const tracked = git('ls-files')
		.split('\n')
		.filter((path) => isCounted(path));
	for (const path of tracked) {
		const counted = scanComments(path, readFileSync(path, 'utf8')).filter(
			(comment) => !comment.allowed,
		);
		const name = area(path);
		const total = totals.get(name) ?? {files: 0, comments: 0, lines: 0};
		totals.set(name, {
			files: total.files + (counted.length > 0 ? 1 : 0),
			comments: total.comments + counted.length,
			lines:
				total.lines +
				counted.reduce(
					(sum, comment) => sum + comment.text.split('\n').length,
					0,
				),
		});
	}

	for (const [name, {files, comments, lines}] of [...totals].toSorted(
		([a], [b]) => a.localeCompare(b, 'en'),
	)) {
		console.log(
			`${name}: ${comments} comments, ${lines} lines, ${files} files`,
		);
	}

	return 0;
}

function main(args: string[]): number {
	if (args.includes('--report')) {
		return report();
	}

	const base = resolveBase(args);
	if (base === undefined) {
		console.error(
			'No merge base with origin/master. Run `git fetch origin master` first.',
		);
		return 1;
	}

	const touched = new Set(touchedFiles(base));
	const baseline = readBaseline();
	for (const path of Object.keys(baseline)) {
		if (!existsSync(path) && git('diff', '--name-only', base, '--', path)) {
			touched.add(path);
		}
	}

	const next = new Map(Object.entries(baseline));
	const problems: Verdict[] = [];
	for (const path of [...touched].toSorted((a, b) =>
		a.localeCompare(b, 'en'),
	)) {
		const count = existsSync(path)
			? countComments(path, readFileSync(path, 'utf8'))
			: 0;
		const atBase = countAtBase(base, path);
		const verdict = judge(path, count, baseline[path], atBase);
		if (!verdict) {
			continue;
		}

		if (args.includes('--write') && count <= (atBase ?? 0)) {
			next.set(path, count);
		} else {
			problems.push(verdict);
		}
	}

	if (args.includes('--write')) {
		const entries = Object.fromEntries(
			[...next].filter(([, count]) => count > 0),
		);
		writeFileSync(BASELINE, formatBaseline(entries));
		console.log(`Wrote ${BASELINE}.`);
	}

	if (problems.length > 0) {
		console.error('Comment ratchet failed:');
		for (const {path, problem} of problems) {
			console.error(`  ${path}: ${problem}`);
		}

		return 1;
	}

	console.log(`Comment ratchet: ${touched.size} touched files in line.`);
	return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	process.exitCode = main(process.argv.slice(2));
}
