import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
	ImportFormatError,
	type ImportKind,
	parseImportFile,
	type ParsedImport,
} from '../../../../extension/src/shared/import-formats';
import {importFromLink} from '../../../../extension/src/shared/import-link';
import {isSharedPageUrl} from '../../../../extension/src/shared/sync/shared-pages';
import {BottomSheet} from '../../ui/bottom-sheet';
import {notify} from '../../ui/dialog';
import {useView} from '../../library/view';
import {useTrash} from '../../library/trash-store';
import {edit, newId, useLibrary} from '../../library/library-store';
import {showSnack} from '../../ui/snackbar';
import {useColors} from '../../ui/theme';
import {importIntoStore, previewFor} from '../../transfer/transfer';
import {Button, Chips, Field, Switch} from '../../ui/widgets';
import {cappedFetch} from '../../transfer/capped-fetch';
import {Title} from './transfer-sheets';

export type ImportSource =
	| {mode: 'file'; name: string; text: string}
	| {mode: 'paste'}
	| {mode: 'link'; url?: string};

type Reading =
	{ok: true; parsed: ParsedImport} | {ok: false; message: string} | undefined;

function read(text: string, name: string): Reading {
	if (text.trim() === '') {
		return undefined;
	}

	try {
		return {ok: true, parsed: parseImportFile(text, name)};
	} catch (error) {
		return {
			ok: false,
			message:
				error instanceof ImportFormatError
					? error.message
					: 'That could not be read as a list of links.',
		};
	}
}

const hasLinks = (groups: ParsedImport['sessions']) =>
	groups.some((group) => group.links.length > 0);

export function ImportSheet({
	source,
	onClose,
}: {
	source: ImportSource | undefined;
	onClose: () => void;
}) {
	const colors = useColors();
	const store = useLibrary();
	const trash = useTrash(useView());
	const [pasted, setPasted] = useState('');
	const [skip, setSkip] = useState(true);
	const [picked, setPicked] = useState<ImportKind>();
	const [busy, setBusy] = useState(false);
	const [link, setLink] = useState('');
	const [linked, setLinked] = useState<Reading>();
	const [fetching, setFetching] = useState(false);
	const text = source?.mode === 'file' ? source.text : pasted;
	const name = source?.mode === 'file' ? source.name : '';
	const typed = useMemo(() => read(text, name), [text, name]);
	const reading = source?.mode === 'link' ? linked : typed;
	const parsed = reading?.ok ? reading.parsed : undefined;
	const sessions = parsed ? hasLinks(parsed.sessions) : false;
	const bookmarks = parsed ? hasLinks(parsed.bookmarks) : false;
	const kind: ImportKind =
		picked ?? parsed?.kind ?? (sessions ? 'sessions' : 'bookmarks');
	const readRef = useRef(0);
	const abortRef = useRef<AbortController | undefined>(undefined);
	const cancelRead = () => {
		readRef.current += 1;
		abortRef.current?.abort();
		abortRef.current = undefined;
		setFetching(false);
	};

	const readLink = async (address: string) => {
		cancelRead();
		const attempt = readRef.current;
		const controller = new AbortController();
		abortRef.current = controller;
		setFetching(true);
		setLinked(undefined);
		let result: Reading;
		try {
			result = {
				ok: true,
				parsed: await importFromLink(cappedFetch(), address, {
					signal: controller.signal,
				}),
			};
		} catch (error) {
			result = {
				ok: false,
				message:
					error instanceof ImportFormatError
						? error.message
						: 'Could not read that link.',
			};
		}

		if (attempt !== readRef.current) {
			return;
		}

		setLinked(result);
		setFetching(false);
	};

	const linkUrl = source?.mode === 'link' ? source.url : undefined;
	useEffect(() => {
		cancelRead();
		setLink(linkUrl ?? '');
		setLinked(undefined);
		setPicked(undefined);
		setSkip(true);
		if (linkUrl && isSharedPageUrl(linkUrl)) {
			void readLink(linkUrl);
		}
	}, [source, linkUrl]);
	const preview = parsed ? previewFor(store, parsed, kind, trash) : undefined;
	const addable = preview ? preview.links - (skip ? preview.duplicates : 0) : 0;
	const sourceRef = useRef(source);
	sourceRef.current = source;
	const run = async () => {
		if (!parsed) {
			return;
		}

		const opened = source;
		setBusy(true);
		try {
			let added = 0;
			await edit((current) => {
				const result = importIntoStore(current, parsed, {
					kind,
					now: Date.now(),
					newId,
					skipDuplicates: skip,
					trash,
				});
				added = result.links;
				return result.store;
			});
			showSnack(
				added === 0
					? 'Nothing new to import'
					: `Imported ${added} ${added === 1 ? 'link' : 'links'}`,
			);
			if (sourceRef.current === opened) {
				onClose();
			}
		} catch {
			notify('Could not import', 'Try again.');
		} finally {
			setBusy(false);
		}
	};

	return (
		<BottomSheet
			visible={source !== undefined}
			label="Import links"
			onClose={onClose}
		>
			<View style={styles.body}>
				<Title>
					{source?.mode === 'file'
						? 'Import a file'
						: source?.mode === 'link'
							? 'Import from a link'
							: 'Import links'}
				</Title>
				{source?.mode === 'link' && (
					<>
						<Field
							autoFocus={!linkUrl}
							label="Shared page link"
							value={link}
							placeholder="https://your-server/p/…"
							keyboardType="url"
							autoCapitalize="none"
							autoCorrect={false}
							onChangeText={(address) => {
								cancelRead();
								setLink(address);
								setLinked(undefined);
								setPicked(undefined);
							}}
							onSubmitEditing={() => void readLink(link)}
						/>
						{!parsed && (
							<Button
								label="Read link"
								icon="link-outline"
								kind="plain"
								disabled={link.trim() === ''}
								loading={fetching}
								onPress={() => void readLink(link)}
							/>
						)}
					</>
				)}
				{source?.mode === 'paste' && (
					<Field
						multiline
						autoFocus
						label="Links, a list, or an export"
						value={pasted}
						placeholder="Paste addresses, Markdown, or what another app exported"
						autoCapitalize="none"
						autoCorrect={false}
						onChangeText={setPasted}
					/>
				)}
				{reading?.ok === false && (
					<Text accessibilityLiveRegion="polite" style={{color: colors.danger}}>
						{reading.message}
					</Text>
				)}
				{parsed && sessions && bookmarks && (
					<Chips
						items={[
							{id: 'sessions', name: 'As sessions'},
							{id: 'bookmarks', name: 'As bookmarks'},
						]}
						selected={kind}
						onSelect={(id) => {
							setPicked(id as ImportKind);
						}}
					/>
				)}
				{parsed && preview && (
					<View style={styles.summary}>
						<Text style={{color: colors.text, fontWeight: '600'}}>
							{parsed.label}
						</Text>
						<Text style={{color: colors.muted}}>
							{preview.links} {preview.links === 1 ? 'link' : 'links'} in{' '}
							{preview.groups}{' '}
							{kind === 'sessions'
								? preview.groups === 1
									? 'session'
									: 'sessions'
								: preview.groups === 1
									? 'column'
									: 'columns'}
							{preview.duplicates > 0
								? `, ${preview.duplicates} already saved, in the trash, or repeated`
								: ''}
							{preview.invalid > 0 ? `, ${preview.invalid} skipped` : ''}
							{preview.pinnedSkipped > 0
								? `, ${preview.pinnedSkipped} pinned ${preview.pinnedSkipped === 1 ? 'tab' : 'tabs'} left out`
								: ''}
						</Text>
						{parsed.warnings.map((warning) => (
							<Text key={warning} style={{color: colors.warn}}>
								{warning}
							</Text>
						))}
						{preview.sample.slice(0, 4).map((sample) => (
							<Text
								key={`${sample.group}-${sample.url}`}
								numberOfLines={1}
								style={{color: colors.muted}}
							>
								{sample.title}
							</Text>
						))}
					</View>
				)}
				{preview && preview.duplicates > 0 && (
					<Switch
						label="Skip links I already have"
						value={skip}
						onValueChange={setSkip}
					/>
				)}
				<Button
					label={
						addable > 0
							? `Import ${addable} ${addable === 1 ? 'link' : 'links'}`
							: 'Import'
					}
					icon="download-outline"
					disabled={addable === 0}
					loading={busy}
					onPress={() => void run()}
				/>
			</View>
		</BottomSheet>
	);
}

let openSource: ImportSource | undefined;
const importListeners = new Set<() => void>();

export function openImport(source: ImportSource | undefined): void {
	openSource = source;
	for (const listener of importListeners) {
		listener();
	}
}

export function ImportHost() {
	const source = useSyncExternalStore(
		(listener) => {
			importListeners.add(listener);
			return () => {
				importListeners.delete(listener);
			};
		},
		() => openSource,
	);
	return (
		<ImportSheet
			source={source}
			onClose={() => {
				openImport(undefined);
			}}
		/>
	);
}

const styles = StyleSheet.create({
	body: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	summary: {gap: 4},
});
