// Uploads proof images to the `evidence` branch through the GitHub contents API and prints Markdown for the
// pull request body. Run it with `vp run evidence <pr-number> <file>...`. It needs `gh` signed in with write access.
// It makes no git push, so the Git hooks do not run. The branch is only a file host: nothing merges from it.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
import process from 'node:process';

function gh(args: string[], input?: string): string {
	return execFileSync('gh', args, {encoding: 'utf8', input}).trim();
}

const [pr, ...files] = process.argv.slice(2);
if (!pr || !/^\d+$/.test(pr) || files.length === 0) {
	throw new Error('Usage: vp run evidence <pr-number> <file>...');
}

const BRANCH = 'evidence';
const repo = gh([
	'repo',
	'view',
	'--json',
	'nameWithOwner',
	'-q',
	'.nameWithOwner',
]);

try {
	gh(['api', `repos/${repo}/git/ref/heads/${BRANCH}`]);
} catch {
	// First use: start the branch at the default branch's head.
	const sha = gh(['api', `repos/${repo}/commits/HEAD`, '-q', '.sha']);
	gh([
		'api',
		`repos/${repo}/git/refs`,
		'-f',
		`ref=refs/heads/${BRANCH}`,
		'-f',
		`sha=${sha}`,
	]);
}

const lines: string[] = [];
for (const file of files) {
	const name = basename(file).replaceAll(/[^\w\-.]/g, '-');
	const path = `evidence/pr${pr}/${name}`;
	const endpoint = `repos/${repo}/contents/${path}`;
	let existing: string | undefined;
	try {
		existing = gh(['api', `${endpoint}?ref=${BRANCH}`, '-q', '.sha']);
	} catch {
		// A new file has no sha to replace.
	}

	const body = {
		message: `evidence: ${name} for #${pr}`,
		content: readFileSync(file).toString('base64'),
		branch: BRANCH,
		...(existing && {sha: existing}),
	};
	gh(['api', '-X', 'PUT', endpoint, '--input', '-'], JSON.stringify(body));
	const url = `https://raw.githubusercontent.com/${repo}/${BRANCH}/${path}`;
	lines.push(
		/\.(?:png|jpe?g|gif|webp)$/i.test(name)
			? `![${name}](${url})`
			: `[${name}](${url})`,
	);
}

console.log(lines.join('\n\n'));
