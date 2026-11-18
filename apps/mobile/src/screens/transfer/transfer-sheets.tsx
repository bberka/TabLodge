import {useMemo, useState, useSyncExternalStore} from 'react';
import {Share, StyleSheet, Text, View} from 'react-native';
import {
	ImportFormatError,
	type ImportKind,
	parseImportFile,
	type ParsedImport,
} from '../../../../extension/src/shared/import-formats';
import {
	buildExport,
	type ExportData,
	type ExportKind,
} from '../../../../extension/src/shared/export-formats';
import {
	type ShareGroup,
	shareCounts,
	shareHtmlPage,
	shareLinks,
	shareMarkdown,
} from '../../../../extension/src/shared/share-formats';
import {
	LOST_CREDENTIAL_NOTE,
	validateCredential,
	weakPasswordHint,
} from '../../../../extension/src/shared/passcode';
import type {Store} from '../../../../extension/src/shared/types';
import {BottomSheet} from '../../ui/bottom-sheet';
import {notify, showDialog} from '../../ui/dialog';
import {buildBackup} from '../../transfer/backup';
import {useView} from '../../library/view';
import {useTrash} from '../../library/trash-store';
import {shareBinaryFile, shareTextFile} from '../../transfer/files';
import {edit, newId, useLibrary} from '../../library/library-store';
import {showSnack} from '../../ui/snackbar';
import {
	copyLink,
	uploadPage,
	useSharedPagesServer,
} from '../../library/shared-pages';
import {openLink} from '../../platform/open-links';
import {useColors} from '../../ui/theme';
import {
	importIntoStore,
	previewFor,
	shareGroupsOf,
} from '../../transfer/transfer';
import {Button, Chips, Field, Switch} from '../../ui/widgets';
import {allCopies} from '../../library/page-copies';

const APP_NAME = 'TabLodge';

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

export type ImportSource =
	{mode: 'file'; name: string; text: string} | {mode: 'paste'};

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

/**
What a file or pasted text would add, and the button that adds it. Skips links that are already saved or in the trash, adds nothing
else, and removes nothing.
*/
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
	const text = source?.mode === 'file' ? source.text : pasted;
	const name = source?.mode === 'file' ? source.name : '';
	const reading = useMemo(() => read(text, name), [text, name]);
	const parsed = reading?.ok ? reading.parsed : undefined;
	const sessions = parsed ? hasLinks(parsed.sessions) : false;
	const bookmarks = parsed ? hasLinks(parsed.bookmarks) : false;
	const kind: ImportKind = picked ?? (sessions ? 'sessions' : 'bookmarks');
	const preview = parsed ? previewFor(store, parsed, kind, trash) : undefined;
	const addable = preview ? preview.links - (skip ? preview.duplicates : 0) : 0;
	const run = async () => {
		if (!parsed) {
			return;
		}

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
			onClose();
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
					{source?.mode === 'file' ? 'Import a file' : 'Import links'}
				</Title>
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
								? `, ${preview.duplicates} already saved or in the trash`
								: ''}
							{preview.invalid > 0 ? `, ${preview.invalid} skipped` : ''}
						</Text>
						{parsed.warnings.map((warning) => (
							<Text key={warning} style={{color: colors.warn}}>
								{warning}
							</Text>
						))}
						{preview.sample.slice(0, 4).map((link) => (
							<Text
								key={`${link.group}-${link.url}`}
								numberOfLines={1}
								style={{color: colors.muted}}
							>
								{link.title}
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

function exportData(store: Store, kind: ExportKind): ExportData {
	return kind === 'sessions'
		? {kind, groups: store.groups, folders: store.folders}
		: {kind, columns: store.bookmarkColumns, bookmarks: store.bookmarks};
}

/**
One thing to share instead of the whole library: a session, a folder, a column, or some bookmarks.
*/
export type ShareScope = {title: string; data: ExportData};

let openScope: ShareScope | undefined;
const scopeListeners = new Set<() => void>();

/**
Opens the share drawer for one thing. `ShareHost`, mounted once near the root, draws it.
*/
export function openShare(scope: ShareScope | undefined): void {
	openScope = scope;
	for (const listener of scopeListeners) {
		listener();
	}
}

export function ShareHost() {
	const scope = useSyncExternalStore(
		(listener) => {
			scopeListeners.add(listener);
			return () => {
				scopeListeners.delete(listener);
			};
		},
		() => openScope,
	);
	return (
		<ShareSheet
			visible={scope !== undefined}
			scope={scope}
			onClose={() => {
				openShare(undefined);
			}}
		/>
	);
}

type Way = 'links' | 'markdown' | 'page' | 'json' | 'csv' | 'html';

const WAYS: Array<{id: Way; name: string}> = [
	{id: 'links', name: 'Links'},
	{id: 'markdown', name: 'Markdown'},
	{id: 'page', name: 'Web page'},
	{id: 'json', name: 'JSON'},
	{id: 'csv', name: 'CSV'},
	{id: 'html', name: 'Bookmarks file'},
];

/**
What a share or export holds, as the named lists of links the text formats take: a session each, or a column each.
*/
function groupsOf(data: ExportData): ShareGroup[] {
	if (data.kind !== 'bookmarks') {
		return shareGroupsOf(data.groups ?? []);
	}

	const names = new Map(
		(data.columns ?? []).map((column) => [column.id, column.name]),
	);
	const grouped = new Map<string, ShareGroup>();
	for (const bookmark of data.bookmarks ?? []) {
		const name = names.get(bookmark.columnId) ?? 'Unfiled';
		const group = grouped.get(name) ?? {name, tabs: []};
		grouped.set(name, {
			...group,
			tabs: [...group.tabs, {title: bookmark.title, url: bookmark.url}],
		});
	}

	return [...grouped.values()];
}

type What = ExportKind | 'backup';

/**
Shares or saves the library, or one part of it. Links and Markdown go through Android's share sheet as text, a web
page, JSON, CSV and a bookmarks file as a file; in Settings, Everything makes a backup ZIP the extension can restore,
with an optional password.
*/
export function ShareSheet({
	visible,
	scope,
	onClose,
}: {
	visible: boolean;
	scope?: ShareScope;
	onClose: () => void;
}) {
	const colors = useColors();
	const store = useLibrary();
	const view = useView();
	const [what, setWhat] = useState<What>('sessions');
	const [way, setWay] = useState<Way>('links');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [uploading, setUploading] = useState(false);
	// The private library is never uploaded.
	const canUpload = useSharedPagesServer() === 'ready' && view === 'regular';
	const sessions = store.groups.length;
	const bookmarks = store.bookmarks.length;
	const isBackup = scope === undefined && what === 'backup';
	const data =
		scope?.data ??
		exportData(store, what === 'bookmarks' ? 'bookmarks' : 'sessions');
	const groups = useMemo(() => groupsOf(data), [data]);
	const {links} = shareCounts(groups);
	const title =
		scope?.title ?? (what === 'bookmarks' ? 'Bookmarks' : 'Sessions');
	const problem =
		isBackup && password !== ''
			? (validateCredential(password) ?? undefined)
			: undefined;
	// A note while the password is short or only digits: it never blocks.
	const weak =
		isBackup && password !== '' && !problem
			? weakPasswordHint(password)
			: undefined;
	const run = async () => {
		setBusy(true);
		try {
			if (isBackup) {
				// Lets the busy state draw before the ZIP is made, which holds the phone's one JavaScript thread for a while.
				await new Promise((resolve) => {
					setTimeout(resolve, 50);
				});
				const file = await buildBackup(
					store,
					APP_NAME,
					password,
					view,
					view === 'regular' ? await allCopies() : [],
				);
				await shareBinaryFile(file.filename, file.mime, file.bytes);
			} else {
				switch (way) {
					case 'links': {
						await Share.share({title, message: shareLinks(groups)});

						break;
					}

					case 'markdown': {
						await Share.share({title, message: shareMarkdown(groups)});

						break;
					}

					case 'page': {
						await shareTextFile(
							`${title.replaceAll(/[^\w-]+/g, '-').slice(0, 40) || 'links'}.html`,
							'text/html',
							shareHtmlPage(title, groups, APP_NAME),
						);

						break;
					}

					default: {
						const file = buildExport(data, way, {appName: APP_NAME});
						await shareTextFile(file.filename, file.mime, file.content);
					}
				}
			}

			setPassword('');
			onClose();
		} catch {
			notify('Could not share', 'Try again.');
		} finally {
			setBusy(false);
		}
	};

	const upload = async () => {
		setUploading(true);
		try {
			const page = await uploadPage(
				title,
				shareHtmlPage(title, groups, APP_NAME),
			);
			onClose();
			await copyLink(page.url);
			showDialog(
				'Page uploaded',
				`${page.url}\n\nThe link is copied. Anyone with it can open the page. To update it, share again. Delete it in Settings › Sync › Shared pages.`,
				[
					{
						label: 'Open',
						run() {
							openLink(page.url);
						},
					},
					{label: 'Done'},
				],
			);
		} catch (error) {
			notify(
				'Could not upload',
				error instanceof Error ? error.message : 'Try again.',
			);
		} finally {
			setUploading(false);
		}
	};

	return (
		<BottomSheet visible={visible} label="Share" onClose={onClose}>
			<View style={styles.body}>
				<Title>{scope ? `Share ${scope.title}` : 'Share or back up'}</Title>
				{scope === undefined && (
					<Chips
						items={[
							{id: 'sessions', name: 'Sessions', count: sessions},
							{id: 'bookmarks', name: 'Bookmarks', count: bookmarks},
							{id: 'backup', name: 'Everything'},
						]}
						selected={what}
						onSelect={(id) => {
							setWhat(id as What);
						}}
					/>
				)}
				{isBackup ? (
					<>
						<Field
							secureTextEntry
							label="Password (optional)"
							icon="lock-closed-outline"
							value={password}
							autoCapitalize="none"
							autoCorrect={false}
							error={problem}
							onChangeText={setPassword}
						/>
						{weak && <Text style={{color: colors.muted}}>{weak}</Text>}
						{view === 'private' && (
							<Text style={{color: colors.muted}}>
								This backs up the private library, not the regular one. Without
								a password the file is not protected.
							</Text>
						)}
						{password !== '' && (
							<Text style={{color: colors.muted}}>{LOST_CREDENTIAL_NOTE}</Text>
						)}
					</>
				) : links === 0 ? (
					<Text style={{color: colors.muted}}>Nothing to share yet.</Text>
				) : (
					<Chips
						items={WAYS}
						selected={way}
						onSelect={(id) => {
							setWay(id as Way);
						}}
					/>
				)}
				<Button
					label="Share"
					icon="share-outline"
					disabled={
						Boolean(problem) ||
						(!isBackup &&
							(links === 0 ||
								(scope === undefined &&
									(what === 'sessions' ? sessions : bookmarks) === 0)))
					}
					loading={busy}
					onPress={() => void run()}
				/>
				{!isBackup && way === 'page' && links > 0 && canUpload && (
					<Button
						label="Upload to my server"
						icon="cloud-upload-outline"
						kind="plain"
						disabled={busy}
						loading={uploading}
						onPress={() => void upload()}
					/>
				)}
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	body: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	title: {fontSize: 20, fontWeight: '700'},
	summary: {gap: 4},
});
