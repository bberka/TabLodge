// Uploads proof images to the rolling `evidence` prerelease and prints Markdown for the pull request body.
// Run it with `vp run evidence <pr-number> <file>...`. It needs `gh` signed in with write access.
// The prerelease never counts as the latest release, so the in app update check ignores it.
import {execFileSync} from 'node:child_process';
import {copyFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import process from 'node:process';

function gh(args: string[]): string {
	return execFileSync('gh', args, {encoding: 'utf8'}).trim();
}

const [pr, ...files] = process.argv.slice(2);
if (!pr || !/^\d+$/.test(pr) || files.length === 0) {
	throw new Error('Usage: vp run evidence <pr-number> <file>...');
}

const TAG = 'evidence';
const repo = gh([
	'repo',
	'view',
	'--json',
	'nameWithOwner',
	'-q',
	'.nameWithOwner',
]);

try {
	gh(['release', 'view', TAG]);
} catch {
	gh([
		'release',
		'create',
		TAG,
		'--prerelease',
		'--title',
		'Pull request evidence',
		'--notes',
		'Screenshots and recordings attached to pull requests. Safe to delete.',
	]);
}

// A copy under a pull request prefixed name keeps uploads from different pull requests apart.
const staging = mkdtempSync(join(tmpdir(), 'tablodge-evidence-'));
const lines: string[] = [];
try {
	for (const file of files) {
		const name = `pr${pr}-${basename(file).replaceAll(/[^\w\-.]/g, '-')}`;
		copyFileSync(file, join(staging, name));
		gh(['release', 'upload', TAG, join(staging, name), '--clobber']);
		const url = `https://github.com/${repo}/releases/download/${TAG}/${name}`;
		lines.push(
			/\.(?:png|jpe?g|gif|webp)$/i.test(name)
				? `![${name}](${url})`
				: `[${name}](${url})`,
		);
	}
} finally {
	rmSync(staging, {recursive: true, force: true});
}

console.log(lines.join('\n\n'));
