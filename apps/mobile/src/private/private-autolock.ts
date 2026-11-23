import {AppState} from 'react-native';
import {onScreenOff} from '../../modules/open-links';
import {getPreferences} from '../settings/preferences';
import {showSnack} from '../ui/snackbar';
import {canLockPrivate, lockPrivate} from './private-library';

const CHECK_EVERY_MS = 10_000;

let lastActive = Date.now();

export function markActive(): void {
	lastActive = Date.now();
}

async function lockIfOpen(): Promise<void> {
	if (!canLockPrivate()) {
		return;
	}

	await lockPrivate();
	showSnack('Private library locked');
}

const idleTooLong = (): boolean => {
	const {privateLockMode, privateLockMinutes} = getPreferences();
	return (
		privateLockMode === 'timeout' &&
		Date.now() - lastActive >= privateLockMinutes * 60_000
	);
};

export function startPrivateAutoLock(): () => void {
	const stopScreen = onScreenOff(() => {
		if (getPreferences().privateLockMode === 'screen') {
			void lockIfOpen();
		}
	});
	const app = AppState.addEventListener('change', (state) => {
		const {privateLockMode} = getPreferences();
		if (state === 'background') {
			if (
				privateLockMode === 'leave' ||
				(privateLockMode === 'screen' && stopScreen === false)
			) {
				void lockIfOpen();
			}
		} else if (state === 'active') {
			if (idleTooLong()) {
				void lockIfOpen();
			}

			markActive();
		}
	});
	const timer = setInterval(() => {
		if (idleTooLong()) {
			void lockIfOpen();
		}
	}, CHECK_EVERY_MS);
	return () => {
		clearInterval(timer);
		app.remove();
		if (stopScreen) {
			stopScreen();
		}
	};
}
