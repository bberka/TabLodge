// Writes src/about/licences.generated.json, the data behind Settings › Open source licences, from what the release
// build really contains. Run with `pnpm run mobile:licences` before bundling; the APK scripts and workflows do.
//
//   node scripts/licences.mts            the JavaScript bundle's packages, plus the native libraries when android/ exists
//   node scripts/licences.mts --native   fail when android/ is missing (release builds)
//   node scripts/licences.mts --stub     only make sure the file exists, for `expo start`
//
// It bundles the app once with source maps to learn which npm packages Metro includes, and asks Gradle for the
// release runtime classpath (scripts/native-licences.gradle). A package without a licence id or text fails the run.
import {execFileSync} from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {
	fromMetroSource,
	licenceData,
	mergeNotices,
	nativeNotices,
	npmNotices,
	type GradleLibraries,
} from '../../../scripts/third-party-notices.ts';
import type {LicenceData} from '../src/about/licence-data.ts';

const mobileDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(mobileDir, '../..');
const androidDir = join(mobileDir, 'android');
const output = join(mobileDir, 'src/about/licences.generated.json');
const args = new Set(process.argv.slice(2));

const write = (data: LicenceData) => {
	writeFileSync(output, `${JSON.stringify(data)}\n`);
};

// The bundle below imports this file, so it has to exist before Metro runs.
if (!existsSync(output)) {
	write({packages: [], texts: []});
}

function generate() {
	const work = mkdtempSync(join(tmpdir(), 'tablodge-licences-'));
	try {
		execFileSync(
			'pnpm',
			[
				'exec',
				'expo',
				'export',
				'--platform',
				'android',
				'--source-maps',
				'--output-dir',
				work,
			],
			{cwd: mobileDir, stdio: ['ignore', 'ignore', 'inherit']},
		);
		const bundleDir = join(work, '_expo/static/js/android');
		const map = readdirSync(bundleDir).find((name) => name.endsWith('.map'));
		if (!map) {
			throw new Error(`expo export wrote no source map in ${bundleDir}`);
		}

		const {sources} = JSON.parse(
			readFileSync(join(bundleDir, map), 'utf8'),
		) as {
			sources: string[];
		};
		const javascript = npmNotices(
			sources.map((source) => fromMetroSource(repoRoot, source)),
		);

		let native: ReturnType<typeof nativeNotices> = [];
		if (existsSync(androidDir)) {
			const librariesFile = join(work, 'native.json');
			execFileSync(
				join(androidDir, 'gradlew'),
				[
					'-q',
					'--init-script',
					join(mobileDir, 'scripts/native-licences.gradle'),
					':app:tablodgeNativeLicences',
					`-PtablodgeLicencesOut=${librariesFile}`,
				],
				{cwd: androidDir, stdio: ['ignore', 'ignore', 'inherit']},
			);
			native = nativeNotices(
				JSON.parse(readFileSync(librariesFile, 'utf8')) as GradleLibraries,
			);
		} else if (args.has('--native')) {
			throw new Error(
				'No android/ project. Run `expo prebuild --platform android` first.',
			);
		} else {
			console.warn(
				'No android/ project, so the list has the JavaScript packages only.',
			);
		}

		const data = licenceData(mergeNotices(javascript, native));
		write(data);
		console.log(
			`Wrote ${data.packages.length} packages (${javascript.length} in the JavaScript bundle, ${native.length} native) to ${output}`,
		);
	} finally {
		rmSync(work, {recursive: true, force: true});
	}
}

if (!args.has('--stub')) {
	generate();
}
