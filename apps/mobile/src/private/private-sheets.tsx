import {useEffect, useState, useSyncExternalStore} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
	clampCredentialInput,
	type CredentialKind,
	credentialRule,
	LOST_CREDENTIAL_NOTE,
	PIN_WEAKNESS_NOTE,
	validateCredential,
} from '../../../extension/src/shared/passcode';
import {BottomSheet} from '../ui/bottom-sheet';
import {confirm, notify} from '../ui/dialog';
import {setPreferences} from '../settings/preferences';
import {showSnack} from '../ui/snackbar';
import {useColors} from '../ui/theme';
import {Button, Field, Segmented} from '../ui/widgets';
import {setView} from '../library/view';
import {
	changePrivateLock,
	getPrivateState,
	openFromServer,
	privateServerInfo,
	protectPrivate,
	removePrivate,
	setupPrivate,
	unlockPrivate,
} from './private-library';

/**
Which private library drawer is open: make the library, open it with its PIN, bring in the server's, set the PIN of one
that has none, or change the PIN it has.
*/
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

/**
Draws the private library drawers. Mount it once, near the root.
*/
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

/**
Choosing a PIN or password, then making the library with it (or, for a library that has none, giving it one, or changing
the one it has). It is asked for twice.
*/
function SetupForm({
	creating = false,
	changing = false,
	deviceOnly = false,
	onBusy,
	onDone,
}: {
	creating?: boolean;
	changing?: boolean;
	/**
	The library is kept on this phone only, so it does not sync with the server it would otherwise try.
	*/
	deviceOnly?: boolean;
	/**
	Told when the form starts and stops saving.
	*/
	onBusy?: (busy: boolean) => void;
	onDone: () => void;
}) {
	const colors = useColors();
	const [kind, setKind] = useState<CredentialKind>('pin');
	const [value, setValue] = useState('');
	const [again, setAgain] = useState('');
	const [currentValue, setCurrentValue] = useState('');
	const [wrong, setWrong] = useState(false);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		onBusy?.(busy);
	}, [busy, onBusy]);
	const problem = validateCredential(kind, value) ?? undefined;
	const mismatch = again !== '' && again !== value;
	const ready =
		(!changing || currentValue !== '') &&
		value !== '' &&
		!problem &&
		again === value;

	const run = async () => {
		setBusy(true);
		try {
			if (changing) {
				const result = await changePrivateLock(currentValue, {kind, value});
				if (result === 'wrong') {
					setWrong(true);
					return;
				}

				if (result === 'error') {
					notify('Could not change it', 'Try again.');
					return;
				}

				showSnack('The PIN or password was changed');
			} else if (creating) {
				if (deviceOnly) {
					// Set first, so the new library does not try the server's key.
					setPreferences({syncPrivate: false});
				}

				await setupPrivate({kind, value});
				setView('private');
			} else {
				if (deviceOnly) {
					setPreferences({syncPrivate: false});
				}

				await protectPrivate({kind, value});
				setView('private');
				showSnack('The private library is locked with its new PIN or password');
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
					? 'Set a PIN or password'
					: changing
						? 'Change the PIN or password'
						: 'Set a PIN or password to open it'}
			</Title>
			<Note>
				{creating
					? 'The private library is a library of its own on this phone, and it opens only with a PIN or password. It works without a server, and syncs with your private windows when you connect one.'
					: changing
						? 'The library keeps its data and its key. Other devices keep working, and a new one needs the new PIN or password.'
						: 'The private library opens only with a PIN or password. It locks the library on this phone, and protects it on your server.'}
			</Note>
			{changing && (
				<Field
					secureTextEntry
					autoFocus
					label="Current PIN or password"
					icon="lock-closed-outline"
					value={currentValue}
					autoCapitalize="none"
					autoCorrect={false}
					error={wrong ? 'That PIN or password is wrong.' : undefined}
					onChangeText={(text) => {
						setCurrentValue(text);
						setWrong(false);
					}}
				/>
			)}
			<Segmented
				label="Protect it with"
				items={[
					{id: 'pin' as const, name: 'PIN', icon: 'keypad-outline' as const},
					{
						id: 'password' as const,
						name: 'Password',
						icon: 'key-outline' as const,
					},
				]}
				selected={kind}
				onSelect={(next) => {
					setKind(next);
					setValue('');
					setAgain('');
				}}
			/>
			{deviceOnly && (
				<Note>
					Kept only on this phone, this library is not synced with your server.
					To sync it later, turn on Sync the private library in Settings and
					enter the server's PIN or password, if it has one.
				</Note>
			)}
			<>
				<Field
					secureTextEntry
					label={kind === 'pin' ? 'PIN' : 'Password'}
					icon="lock-closed-outline"
					value={value}
					keyboardType={kind === 'pin' ? 'number-pad' : 'default'}
					autoCapitalize="none"
					autoCorrect={false}
					error={value === '' ? undefined : problem}
					onChangeText={(text) => {
						setValue(clampCredentialInput(kind, text));
					}}
				/>
				<Field
					secureTextEntry
					label="Type it again"
					icon="lock-closed-outline"
					value={again}
					keyboardType={kind === 'pin' ? 'number-pad' : 'default'}
					autoCapitalize="none"
					autoCorrect={false}
					error={mismatch ? 'These do not match.' : undefined}
					onChangeText={(text) => {
						setAgain(clampCredentialInput(kind, text));
					}}
				/>
				<Text style={{color: colors.muted}}>{credentialRule(kind)}</Text>
				{kind === 'pin' && <Note>{PIN_WEAKNESS_NOTE}</Note>}
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

/**
Opens a locked library with its PIN or password.
*/
function UnlockForm({onDone}: {onDone: () => void}) {
	const colors = useColors();
	const [value, setValue] = useState('');
	const [problem, setProblem] = useState<string>();
	const [busy, setBusy] = useState(false);
	// An erase is running: unlocking waits, so it cannot open a library that is being deleted.
	const [erasing, setErasing] = useState(false);
	const run = async () => {
		setBusy(true);
		const result = await unlockPrivate(value);
		setBusy(false);
		if (result === 'ok') {
			const state = getPrivateState();
			if (state.exists && !state.needsPin) {
				setView('private');
			}

			onDone();
		} else {
			setProblem(
				result === 'wrong'
					? 'That PIN or password is wrong.'
					: 'Could not open it. Try again.',
			);
		}
	};

	return (
		<View style={styles.body}>
			<Title>Unlock the private library</Title>
			<Field
				secureTextEntry
				autoFocus
				label="PIN or password"
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
			<Text style={{color: colors.muted}}>
				Erasing deletes the private library from this phone, with its PIN or
				password, and asks for a new one. Your server keeps its copy.
			</Text>
		</View>
	);
}

/**
Asks before the private library is erased from this phone, erases it, and opens the set-a-PIN drawer once it is gone. A
failure is reported and leaves the library as it was, so the erase can be tried again. Both entry points use it.
*/
export function confirmErase(
	afterErase?: () => void,
	onWorking?: (working: boolean) => void,
) {
	confirm(
		'Erase the private library from this phone?',
		'Its bookmarks and sessions and its PIN or password are deleted from this phone, and you start again with a new PIN or password. Your server keeps its copy, if it has one, and you can bring it back from there with its PIN or password.',
		{label: 'Erase', destructive: true},
		() => {
			onWorking?.(true);
			removePrivate().then(
				() => {
					onWorking?.(false);
					afterErase?.();
					openPrivateSheet('setup');
				},
				() => {
					onWorking?.(false);
					notify(
						'Could not finish erasing',
						'Some of it may already be gone. Try again to finish.',
					);
				},
			);
		},
	);
}

/**
The first PIN or password of the private library, for a new one or for one that has none. When the connected server
already holds a private library, its PIN or password comes first: it becomes this library's lock, and the server's data
joins what is here. Keeping the library on this phone only, with a PIN or password of its own, stays available. When the
server cannot be asked, the drawer says so, offers a retry, and sets the library up on the phone only: it is not synced
until the server's PIN or password is entered from Settings.
*/
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
	// A form is checking or saving: the choice between them waits, so a pending join cannot land after a local save.
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
						this one is kept on this phone only. Try again, or set a PIN or
						password now and enter the server's from Settings later.
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
								? 'Use the PIN from my sync server'
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

/**
Brings in the private library the extension keeps on the server. A protected one asks for the PIN or password set in
the extension, once; the phone's library takes that lock and syncs with the server's.
*/
function ServerForm({
	known = false,
	onBusy,
	onDone,
}: {
	/**
	The server is known to hold a protected library, so its PIN or password is asked for at once.
	*/
	known?: boolean;
	/**
	Told when the form starts and stops checking.
	*/
	onBusy?: (busy: boolean) => void;
	onDone: () => void;
}) {
	const [asking, setAsking] = useState(known);
	const [value, setValue] = useState('');
	const [problem, setProblem] = useState<string>();
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		onBusy?.(busy);
	}, [busy, onBusy]);
	const run = async (credential?: string) => {
		setBusy(true);
		let result: Awaited<ReturnType<typeof openFromServer>>;
		try {
			result = await openFromServer(credential);
		} finally {
			setBusy(false);
		}

		if (result.ok) {
			// A library that still has no PIN does not open.
			if (!getPrivateState().needsPin) {
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
				setProblem('That PIN or password is wrong.');
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
					? "Use your sync server's PIN"
					: "Use your server's private library"}
			</Title>
			<Note>
				The private windows' library on your server comes to this phone and
				syncs both ways. What is already on this phone stays.
			</Note>
			{known && (
				<Note>
					If you no longer have it, keep the library only on this phone instead
					and set a new PIN or password.
				</Note>
			)}
			{asking && (
				<Field
					secureTextEntry
					autoFocus
					label="PIN or password from the extension"
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
});
