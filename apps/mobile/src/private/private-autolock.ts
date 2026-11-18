/*
Locks the private library by itself, as the person chose in Settings: when the app goes behind another one, when the
screen turns off, or after a while without a touch. Only a library with a password locks.
*/
import {AppState} from 'react-native';
import {onScreenOff} from '../../modules/open-links';
import {getPreferences} from '../settings/preferences';
import {showSnack} from '../ui/snackbar';
import {canLockPrivate, lockPrivate} from './private-library';

const CHECK_EVERY_MS = 10_000;

let lastActive = Date.now();

/**
Notes that the person touched the screen, which restarts the wait of "after a while".
*/
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

/**
Starts watching. Call it once, and call the function it returns to stop.
*/
export function startPrivateAutoLock(): () => void {
	const stopScreen = onScreenOff(() => {
		if (getPreferences().privateLockMode === 'screen') {
			void lockIfOpen();
		}
	});
	const app = AppState.addEventListener('change', (state) => {
		const {privateLockMode} = getPreferences();
		if (state === 'background') {
			// Without the screen-off signal (an older build), turning the screen off is the closest to it.
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
