import {useState, useSyncExternalStore} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
	clampCredentialInput,
	type CredentialKind,
	credentialRule,
	LOST_CREDENTIAL_NOTE,
	PIN_WEAKNESS_NOTE,
	validateCredential,
} from '../../extension/src/shared/passcode';
import {BottomSheet} from './bottom-sheet';
import {notify} from './dialog';
import {
	openFromServer,
	protectPrivate,
	setupPrivate,
	unlockPrivate,
} from './private-library';
import {showSnack} from './snackbar';
import {useColors} from './theme';
import {Button, Field, Segmented} from './ui';
import {setView} from './view';

/**
Which private library drawer is open: make the library, open it with its PIN, bring in the server's, or add a PIN to one
that has none.
*/
export type PrivateSheet = 'setup' | 'unlock' | 'server' | 'protect';

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
			{open === 'setup' && <SetupForm withNone onDone={close} />}
			{open === 'protect' && <SetupForm onDone={close} />}
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

type Lock = CredentialKind | 'none';

/**
Choosing how the library is protected, then making it (or, for a library without a lock, adding one). A PIN or password
is asked for twice.
*/
function SetupForm({
	withNone = false,
	onDone,
}: {
	withNone?: boolean;
	onDone: () => void;
}) {
	const colors = useColors();
	const [lock, setLock] = useState<Lock>(withNone ? 'none' : 'pin');
	const [value, setValue] = useState('');
	const [again, setAgain] = useState('');
	const [busy, setBusy] = useState(false);
	const kind = lock === 'none' ? undefined : lock;
	const problem = kind
		? (validateCredential(kind, value) ?? undefined)
		: undefined;
	const mismatch = kind !== undefined && again !== '' && again !== value;
	const ready =
		kind === undefined || (value !== '' && !problem && again === value);

	const run = async () => {
		setBusy(true);
		try {
			if (withNone) {
				await setupPrivate(kind ? {kind, value} : undefined);
				setView('private');
			} else if (kind) {
				await protectPrivate({kind, value});
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
				{withNone ? 'Set up the private library' : 'Add a PIN or password'}
			</Title>
			<Note>
				{withNone
					? 'A library of its own on this phone. It works without a server, and syncs with your private windows when you connect one.'
					: 'It locks the library on this phone, and protects it on your server.'}
			</Note>
			<Segmented
				label="Protect it with"
				items={[
					...(withNone
						? [
								{
									id: 'none' as const,
									name: 'Nothing',
									icon: 'lock-open-outline' as const,
								},
							]
						: []),
					{id: 'pin' as const, name: 'PIN', icon: 'keypad-outline' as const},
					{
						id: 'password' as const,
						name: 'Password',
						icon: 'key-outline' as const,
					},
				]}
				selected={lock}
				onSelect={(next) => {
					setLock(next);
					setValue('');
					setAgain('');
				}}
			/>
			{kind && (
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
			)}
			<Button
				label={withNone ? 'Create the private library' : 'Add the lock'}
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
	const [value, setValue] = useState('');
	const [problem, setProblem] = useState<string>();
	const [busy, setBusy] = useState(false);
	const run = async () => {
		setBusy(true);
		const result = await unlockPrivate(value);
		setBusy(false);
		if (result === 'ok') {
			setView('private');
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
				disabled={value === ''}
				loading={busy}
				onPress={() => void run()}
			/>
		</View>
	);
}

/**
Brings in the private library the extension keeps on the server. A protected one asks for the PIN or password set in
the extension, once; the phone's library takes that lock and syncs with the server's.
*/
function ServerForm({onDone}: {onDone: () => void}) {
	const [asking, setAsking] = useState(false);
	const [value, setValue] = useState('');
	const [problem, setProblem] = useState<string>();
	const [busy, setBusy] = useState(false);
	const run = async (credential?: string) => {
		setBusy(true);
		const result = await openFromServer(credential);
		setBusy(false);
		if (result.ok) {
			setView('private');
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
			<Title>Use your server's private library</Title>
			<Note>
				The private windows' library on your server comes to this phone and
				syncs both ways. What is already on this phone stays.
			</Note>
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
