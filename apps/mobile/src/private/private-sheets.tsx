import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
	LOST_CREDENTIAL_NOTE,
	sameCredential,
	validateCredential,
	weakPasswordHint,
} from '../../../extension/src/shared/passcode';
import {BottomSheet} from '../ui/bottom-sheet';
import {confirm, notify} from '../ui/dialog';
import {setPreferences} from '../settings/preferences';
import {showSnack} from '../ui/snackbar';
import {useColors} from '../ui/theme';
import {Button, Field, IconButton} from '../ui/widgets';
import {setView} from '../library/view';
import {
	changePrivateLock,
	eraseFailureNotice,
	isPrivateOpen,
	openFromServer,
	privateEraseCopy,
	privateEraseNotice,
	privateServerInfo,
	protectPrivate,
	removePrivate,
	setupPrivate,
	unlockPrivate,
	type PrivateEraseCopy,
} from './private-library';

export type PrivateSheet = 'setup' | 'unlock' | 'server' | 'protect' | 'change';

let current: PrivateSheet | undefined;
const listeners = new Set<() => void>();

const set = (next: PrivateSheet | undefined) => {
	current = next;
	for (const listener of listeners) {
		listener();
	}
};

export const openPrivateSheet = (sheet: PrivateSheet): void => {
	set(sheet);
};

export function PrivateSheetHost() {
	const open = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => current,
	);
	const close = () => {
		set(undefined);
	};

	return (
		<BottomSheet
			visible={open !== undefined}
			label="Private library"
			onClose={close}
		>
			{open === 'setup' && <FirstPin creating onDone={close} />}
			{open === 'protect' && <FirstPin onDone={close} />}
			{open === 'change' && <SetupForm changing onDone={close} />}
			{open === 'unlock' && <UnlockForm onDone={close} />}
			{open === 'server' && <ServerForm onDone={close} />}
		</BottomSheet>
	);
}

function Title({children}: {children: string}) {
	const colors = useColors();
	return (
		<Text
			accessibilityRole="header"
			style={[styles.title, {color: colors.text}]}
		>
			{children}
		</Text>
	);
}

function Note({children}: {children: string}) {
	const colors = useColors();
	return <Text style={{color: colors.muted}}>{children}</Text>;
}

function SetupForm({
	creating = false,
	changing = false,
	deviceOnly = false,
	onBusy,
	onDone,
}: {
	creating?: boolean;
	changing?: boolean;
	deviceOnly?: boolean;
	onBusy?: (busy: boolean) => void;
	onDone: () => void;
}) {
	const colors = useColors();
	const [value, setValue] = useState('');
	const [again, setAgain] = useState('');
	const [currentValue, setCurrentValue] = useState('');
	const [wrong, setWrong] = useState(false);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		onBusy?.(busy);
	}, [busy, onBusy]);
	const problem = validateCredential(value) ?? undefined;
	const weak = value === '' || problem ? undefined : weakPasswordHint(value);
	const mismatch = again !== '' && !sameCredential(again, value);
	const ready =
		(!changing || currentValue !== '') &&
		value !== '' &&
		!problem &&
		sameCredential(again, value);

	const run = async () => {
		setBusy(true);
		try {
			if (changing) {
				const result = await changePrivateLock(currentValue, {value});
				if (result === 'wrong') {
					setWrong(true);
					return;
				}

				if (result === 'error') {
					notify('Could not change it', 'Try again.');
					return;
				}

				showSnack('The password was changed');
			} else if (creating) {
				if (deviceOnly) {
					setPreferences({syncPrivate: false});
				}

				await setupPrivate({value});
				if (isPrivateOpen()) {
					setView('private');
				}
			} else {
				if (deviceOnly) {
					setPreferences({syncPrivate: false});
				}

				await protectPrivate({value});
				if (isPrivateOpen()) {
					setView('private');
				}

				showSnack('The private library is locked with its new password');
			}

			onDone();
		} catch {
			notify('Could not set it up', 'Try again.');
		} finally {
			setBusy(false);
		}
	};

	return (
		<View style={styles.body}>
			<Title>
				{creating
					? 'Set a password'
					: changing
						? 'Change the password'
						: 'Set a password to open it'}
			</Title>
			<Note>
				{creating
					? 'The private library is a library of its own on this phone, and it opens only with a password. It works without a server, and syncs with your private windows when you connect one.'
					: changing
						? 'The library keeps its data and its key. Other devices keep working, and a new one needs the new password.'
						: 'The private library opens only with a password. It locks the library on this phone, and protects it on your server.'}
			</Note>
			{changing && (
				<Field
					secureTextEntry
					autoFocus
					label="Current password"
					icon="lock-closed-outline"
					value={currentValue}
					autoCapitalize="none"
					autoCorrect={false}
					error={wrong ? 'That password is wrong.' : undefined}
					onChangeText={(text) => {
						setCurrentValue(text);
						setWrong(false);
					}}
				/>
			)}
			{deviceOnly && (
				<Note>
					Kept only on this phone, this library is not synced with your server.
					To sync it later, turn on Sync the private library in Settings and
					enter the server's password, if it has one.
				</Note>
			)}
			<>
				<Field
					secureTextEntry
					label="Password"
					icon="lock-closed-outline"
					value={value}
					autoCapitalize="none"
					autoCorrect={false}
					error={value === '' ? undefined : problem}
					onChangeText={(text) => {
						setValue(text);
					}}
				/>
				{}
				<Text
					accessibilityLiveRegion="polite"
					style={{color: colors.muted, marginTop: weak ? 0 : -14}}
				>
					{weak ?? ''}
				</Text>
				<Field
					secureTextEntry
					label="Type it again"
					icon="lock-closed-outline"
					value={again}
					autoCapitalize="none"
					autoCorrect={false}
					error={mismatch ? 'These do not match.' : undefined}
					onChangeText={(text) => {
						setAgain(text);
					}}
				/>
				<Note>{LOST_CREDENTIAL_NOTE}</Note>
			</>
			<Button
				label={
					creating
						? 'Create the private library'
						: changing
							? 'Change it'
							: 'Set it and open'
				}
				icon="checkmark"
				disabled={!ready}
				loading={busy}
				onPress={() => void run()}
			/>
		</View>
	);
}

function UnlockForm({onDone}: {onDone: () => void}) {
	const colors = useColors();
	const [value, setValue] = useState('');
	const [problem, setProblem] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [eraseCopy, setEraseCopy] = useState<PrivateEraseCopy>();
	useEffect(() => {
		let live = true;
		void privateEraseCopy().then((copy) => {
			if (live) {
				setEraseCopy(copy);
			}
		});
		return () => {
			live = false;
		};
	}, []);
	const dismissedRef = useRef(false);
	useEffect(() => {
		dismissedRef.current = false;
		return () => {
			dismissedRef.current = true;
		};
	}, []);
	const [erasing, setErasing] = useState(false);
	const run = async () => {
		setBusy(true);
		let result: Awaited<ReturnType<typeof unlockPrivate>>;
		try {
			result = await unlockPrivate(value);
		} finally {
			setBusy(false);
		}

		if (dismissedRef.current) {
			return;
		}

		if (result === 'ok') {
			if (isPrivateOpen()) {
				setView('private');
			}

			onDone();
		} else {
			setProblem(
				result === 'wrong'
					? 'That password is wrong.'
					: 'Could not open it. Try again.',
			);
		}
	};

	return (
		<View style={styles.body}>
			<View style={styles.headRow}>
				<View style={styles.headText}>
					<Title>Unlock the private library</Title>
				</View>
				<IconButton icon="close" label="Close" onPress={onDone} />
			</View>
			<Field
				secureTextEntry
				autoFocus
				label="Password"
				icon="lock-closed-outline"
				value={value}
				autoCapitalize="none"
				autoCorrect={false}
				error={problem}
				onChangeText={(text) => {
					setValue(text);
					setProblem(undefined);
				}}
			/>
			<Button
				label="Unlock"
				icon="lock-open-outline"
				disabled={value === '' || erasing}
				loading={busy}
				onPress={() => void run()}
			/>
			<Button
				label="Forgot it? Erase private data"
				icon="trash-outline"
				kind="danger"
				disabled={busy || erasing}
				onPress={() => {
					confirmErase(onDone, setErasing);
				}}
			/>
			<Text style={{color: colors.muted}}>{privateEraseNotice(eraseCopy)}</Text>
		</View>
	);
}

export function confirmErase(
	afterErase?: () => void,
	onWorking?: (working: boolean) => void,
) {
	confirm(
		'Erase the private library from this phone?',
		'Its bookmarks and sessions and its password are deleted from this phone, and you start again with a new password. Your server keeps its copy, if it has one, and you can bring it back from there with its password.',
		{label: 'Erase', destructive: true},
		() => {
			onWorking?.(true);
			removePrivate().then(
				() => {
					onWorking?.(false);
					afterErase?.();
					openPrivateSheet('setup');
				},
				(error: unknown) => {
					onWorking?.(false);
					const {title, message} = eraseFailureNotice(error);
					notify(title, message);
				},
			);
		},
	);
}

function FirstPin({
	creating = false,
	onDone,
}: {
	creating?: boolean;
	onDone: () => void;
}) {
	const colors = useColors();
	const [server, setServer] = useState<{
		connected: boolean;
		hasKey: boolean;
		failed: boolean;
	}>();
	const [deviceOnly, setDeviceOnly] = useState(false);
	const [working, setWorking] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		setServer(undefined);
		void privateServerInfo().then(setServer);
	}, [attempt]);
	if (!server) {
		return (
			<View style={styles.body}>
				<Note>Checking your sync server…</Note>
			</View>
		);
	}

	const fromServer = server.hasKey && !deviceOnly;
	return (
		<View style={{gap: 14}}>
			{server.failed && (
				<View style={styles.body}>
					<Text style={{color: colors.warn}}>
						Could not reach your sync server to check for a private library, so
						this one is kept on this phone only. Try again, or set a password
						now and enter the server's from Settings later.
					</Text>
					<Button
						label="Try again"
						icon="refresh-outline"
						kind="plain"
						disabled={working}
						onPress={() => {
							setAttempt(attempt + 1);
						}}
					/>
				</View>
			)}
			{fromServer ? (
				<ServerForm known onBusy={setWorking} onDone={onDone} />
			) : (
				<SetupForm
					creating={creating}
					deviceOnly={(server.hasKey && deviceOnly) || server.failed}
					onBusy={setWorking}
					onDone={onDone}
				/>
			)}
			{server.hasKey && (
				<View style={styles.body}>
					<Button
						label={
							deviceOnly
								? 'Use the password from my sync server'
								: 'Keep only on this phone instead'
						}
						kind="plain"
						disabled={working}
						icon={
							deviceOnly ? 'cloud-download-outline' : 'phone-portrait-outline'
						}
						onPress={() => {
							setDeviceOnly(!deviceOnly);
						}}
					/>
				</View>
			)}
		</View>
	);
}

function ServerForm({
	known = false,
	onBusy,
	onDone,
}: {
	known?: boolean;
	onBusy?: (busy: boolean) => void;
	onDone: () => void;
}) {
	const [asking, setAsking] = useState(known);
	const [value, setValue] = useState('');
	const [problem, setProblem] = useState<string>();
	const [busy, setBusy] = useState(false);
	const dismissedRef = useRef(false);
	useEffect(() => {
		dismissedRef.current = false;
		return () => {
			dismissedRef.current = true;
		};
	}, []);
	useEffect(() => {
		onBusy?.(busy);
	}, [busy, onBusy]);
	const run = async (credential?: string) => {
		setBusy(true);
		let result: Awaited<ReturnType<typeof openFromServer>>;
		try {
			result = await openFromServer(credential, () => dismissedRef.current);
		} finally {
			setBusy(false);
		}

		if (dismissedRef.current) {
			return;
		}

		if (result.ok) {
			if (isPrivateOpen()) {
				setView('private');
			}

			onDone();
			return;
		}

		switch (result.reason) {
			case 'credential': {
				setAsking(true);
				break;
			}

			case 'wrong': {
				setProblem('That password is wrong.');
				break;
			}

			case 'sync-off': {
				notify(
					'Private sync is off',
					'Turn on Sync the private library in Settings, then try again. The private library syncs through the same server.',
				);
				break;
			}

			case 'not-connected': {
				notify(
					'Not connected',
					'Connect to your sync server in Settings first. The private library syncs through the same server.',
				);
				break;
			}

			default: {
				notify('Could not open it', result.message ?? 'Try again.');
			}
		}
	};

	return (
		<View style={styles.body}>
			<Title>
				{known
					? "Use your sync server's password"
					: "Use your server's private library"}
			</Title>
			<Note>
				The private windows' library on your server comes to this phone and
				syncs both ways. What is already on this phone stays.
			</Note>
			{known && (
				<Note>
					If you no longer have it, keep the library only on this phone instead
					and set a new password.
				</Note>
			)}
			{asking && (
				<Field
					secureTextEntry
					autoFocus
					label="Password for the server's private library"
					icon="lock-closed-outline"
					value={value}
					autoCapitalize="none"
					autoCorrect={false}
					error={problem}
					onChangeText={(text) => {
						setValue(text);
						setProblem(undefined);
					}}
				/>
			)}
			<Button
				label={asking ? 'Unlock and sync' : 'Bring it in'}
				icon="sync-outline"
				disabled={asking && value === ''}
				loading={busy}
				onPress={() => void run(asking ? value : undefined)}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	body: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	title: {fontSize: 20, fontWeight: '700'},
	headRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
	headText: {flex: 1},
});
