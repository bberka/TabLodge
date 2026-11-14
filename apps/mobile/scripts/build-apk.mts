// Builds a standalone Android APK from the current checkout, to install on a phone and try. Run it with
// `pnpm run mobile:apk`, or `pnpm run mobile:apk --install` to also install it on the device adb sees.
//
// The APK is a release build (the JavaScript is bundled in, no Metro needed) signed with the local debug key, so it
// installs next to nothing else: Android refuses to update the released app with it, and uninstalling the released
// app first removes its local data. It carries the ARM libraries phones use, and arm64 only unless --all-abis is given.
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const mobileDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(mobileDir, 'android');
const outputApk = join(
	androidDir,
	'app/build/outputs/apk/release/app-release.apk',
);
const copiedApk = join(mobileDir, 'dist/tablodge-local.apk');
const args = new Set(process.argv.slice(2));

const sdkRoot =
	process.env.ANDROID_HOME ??
	process.env.ANDROID_SDK_ROOT ??
	[join(homedir(), 'Android/Sdk'), join(homedir(), 'Library/Android/sdk')].find(
		(path) => existsSync(path),
	);
if (!sdkRoot) {
	throw new Error('Android SDK not found. Install it and set ANDROID_HOME.');
}

process.env.ANDROID_HOME = sdkRoot;
process.env.ANDROID_SDK_ROOT = sdkRoot;
const abis = args.has('--all-abis') ? 'arm64-v8a,armeabi-v7a' : 'arm64-v8a';

function run(command: string, commandArgs: string[], cwd: string) {
	console.log(`\n> ${command} ${commandArgs.join(' ')}`);
	execFileSync(command, commandArgs, {cwd, stdio: 'inherit'});
}

run(
	'pnpm',
	['exec', 'expo', 'prebuild', '--platform', 'android', '--no-install'],
	mobileDir,
);
run(
	join(androidDir, 'gradlew'),
	['assembleRelease', '-x', 'lint', `-PreactNativeArchitectures=${abis}`],
	androidDir,
);

mkdirSync(dirname(copiedApk), {recursive: true});
copyFileSync(outputApk, copiedApk);
console.log(`\nAPK ready: ${copiedApk}`);

if (args.has('--install')) {
	run(
		join(sdkRoot, 'platform-tools/adb'),
		['install', '-r', copiedApk],
		mobileDir,
	);
} else {
	console.log(
		'Install it with: adb install -r apps/mobile/dist/tablodge-local.apk (or copy the file to the phone).',
	);
}
