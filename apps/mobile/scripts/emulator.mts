// Starts or stops the Android emulator for proof screenshots. `pnpm run mobile:emulator` starts the first AVD
// (or the one named by --avd) with a visible window and software GPU, waits until Android has booted, and prints
// the adb serial. `--headless` starts it without a window. `pnpm run mobile:emulator --stop` shuts it down. An
// emulator that is already running is reused.
import {execFileSync, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';

const sdkRoot =
	process.env.ANDROID_HOME ??
	process.env.ANDROID_SDK_ROOT ??
	[join(homedir(), 'Android/Sdk'), join(homedir(), 'Library/Android/sdk')].find(
		(path) => existsSync(path),
	);
if (!sdkRoot) {
	throw new Error('Android SDK not found. Install it and set ANDROID_HOME.');
}

const adb = join(sdkRoot, 'platform-tools/adb');
const emulator = join(sdkRoot, 'emulator/emulator');
const args = process.argv.slice(2);

function runningSerial(): string | undefined {
	const out = execFileSync(adb, ['devices'], {encoding: 'utf8'});
	return /^(emulator-\d+)\s+device$/m.exec(out)?.[1];
}

if (args.includes('--stop')) {
	const running = runningSerial();
	if (running) {
		execFileSync(adb, ['-s', running, 'emu', 'kill']);
		console.log(`Stopped ${running}`);
	} else {
		console.log('No emulator running');
	}

	process.exitCode = 0;
} else {
	let serial = runningSerial();
	if (serial) {
		console.log(`Reusing ${serial}`);
	} else {
		const avdFlag = args.indexOf('--avd');
		const avd =
			avdFlag === -1
				? execFileSync(emulator, ['-list-avds'], {encoding: 'utf8'})
						.split('\n')
						.find(Boolean)
				: args[avdFlag + 1];
		if (!avd) {
			throw new Error('No AVD found. Create one in Android Studio.');
		}

		spawn(
			emulator,
			[
				'-avd',
				avd,
				...(args.includes('--headless') ? ['-no-window'] : []),
				'-no-audio',
				'-gpu',
				'swiftshader_indirect',
			],
			{
				detached: true,
				stdio: 'ignore',
			},
		).unref();
		execFileSync(adb, ['wait-for-device']);
		const deadline = Date.now() + 5 * 60_000;
		while (Date.now() < deadline) {
			serial = runningSerial();
			if (
				serial &&
				execFileSync(
					adb,
					['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
					{
						encoding: 'utf8',
					},
				).trim() === '1'
			) {
				break;
			}

			await new Promise((resolve) => {
				setTimeout(resolve, 2000);
			});
		}

		if (!serial) {
			throw new Error('The emulator did not finish booting in 5 minutes.');
		}
	}

	console.log(`Emulator ready: ${serial}`);
}
