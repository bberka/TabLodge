import Constants from 'expo-constants';
import {Directory, File, Paths} from 'expo-file-system';
import {
	canInstallHere,
	installAllowed,
	installApk,
	openInstallSettings,
} from '../../modules/app-update';
import {openLink} from '../platform/open-links';
import {readJson, writeJson} from '../platform/storage';
import {notify, showDialog} from '../ui/dialog';
import {
	APK_NAME,
	checkForUpdate,
	downloadLabel,
	LATEST_RELEASE_URL,
	parseCache,
} from './update-check';

const CACHE_KEY = 'tablodge.update.check';

async function fetchLatest(): Promise<unknown> {
	const response = await fetch(LATEST_RELEASE_URL);
	if (!response.ok) {
		throw new Error(`GitHub answered ${response.status}`);
	}

	return response.json();
}

async function download(
	url: string,
	busy: (label?: string) => void,
): Promise<File> {
	const folder = new Directory(Paths.cache, 'updates');
	folder.create({idempotent: true, intermediates: true});
	const target = new File(folder, APK_NAME);
	if (target.exists) {
		target.delete();
	}

	return File.downloadFileAsync(url, target, {
		onProgress({bytesWritten, totalBytes}) {
			busy(downloadLabel(bytesWritten, totalBytes));
		},
	});
}

async function install(
	apkUrl: string,
	busy: (label?: string) => void,
): Promise<void> {
	if (!canInstallHere) {
		openLink(apkUrl);
		return;
	}

	if (!installAllowed()) {
		notify(
			'Allow installs',
			'Android needs your permission before TabLodge can install an update. Turn on "Allow from this source" on the next screen, come back, and check for updates again.',
		);
		openInstallSettings();
		return;
	}

	busy('Downloading…');
	try {
		const file = await download(apkUrl, busy);
		if (!installApk(file.uri.replace(/^file:\/\//, ''))) {
			notify('Could not start the install', 'Try again in a moment.');
		}
	} catch {
		notify(
			'Download failed',
			'Check your connection and try again. Nothing was changed.',
		);
	} finally {
		busy();
	}
}

/**
Asks GitHub for the newest release, at most once an hour, and tells the person what it found. When there is a newer one,
the dialog's button downloads the APK and hands it to Android's installer. `busy` is told what is going on, and called
with nothing when it is over.
*/
export async function checkAndOfferUpdate(
	busy: (label?: string) => void,
): Promise<void> {
	busy('Checking…');
	const installed = Constants.expoConfig?.version ?? '';
	let result;
	try {
		result = await checkForUpdate({
			installed,
			now: Date.now(),
			cache: parseCache(await readJson(CACHE_KEY)),
			fetchLatest,
		});
		if (result.cache) {
			await writeJson(CACHE_KEY, result.cache);
		}
	} finally {
		busy();
	}

	const {outcome} = result;
	if (outcome.status === 'failed') {
		notify(
			'Could not check',
			'GitHub did not answer. Check your connection and try again later.',
		);
	} else if (outcome.status === 'current') {
		notify('Up to date', `TabLodge v${installed} is the newest version.`);
	} else {
		showDialog(
			`TabLodge v${outcome.version} is out`,
			`You have v${installed}. The update keeps your library and settings.`,
			[
				{label: 'Later', kind: 'cancel'},
				{
					label: 'Download and install',
					run() {
						void install(outcome.apkUrl, busy);
					},
				},
			],
		);
	}
}
