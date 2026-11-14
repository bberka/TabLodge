import {useMemo, useState, useSyncExternalStore} from 'react';
import {Share, StyleSheet, Text, View} from 'react-native';
import {
	ImportFormatError,
	type ImportKind,
	parseImportFile,
	type ParsedImport,
} from '../../../extension/src/shared/import-formats';
import {
	buildExport,
	type ExportData,
	type ExportFormat,
	type ExportKind,
} from '../../../extension/src/shared/export-formats';
import {
	shareCounts,
	shareHtmlPage,
	shareLinks,
	shareMarkdown,
} from '../../../extension/src/shared/share-formats';
import {
	LOST_CREDENTIAL_NOTE,
	validateCredential,
} from '../../../extension/src/shared/passcode';
import type {Session, Store} from '../../../extension/src/shared/types';
import {BottomSheet} from '../bottom-sheet';
import {notify} from '../dialog';
import {buildBackup} from '../backup';
import {shareBinaryFile, shareTextFile} from '../files';
import {edit, newId, useLibrary} from '../library-store';
import {showSnack} from '../snackbar';
import {useColors} from '../theme';
import {importIntoStore, previewFor, shareGroupsOf} from '../transfer';
import {Button, Chips, Field, Switch} from '../ui';

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
What a file or pasted text would add, and the button that adds it. Skips links that are already saved, adds nothing
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
	const preview = parsed ? previewFor(store, parsed, kind) : undefined;
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
								? `, ${preview.duplicates} already saved`
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

const EXPORT_FORMAT_CHOICES: Array<{id: ExportFormat; name: string}> = [
	{id: 'json', name: 'JSON'},
	{id: 'html', name: 'HTML page'},
	{id: 'csv', name: 'CSV'},
	{id: 'markdown', name: 'Markdown'},
	{id: 'txt', name: 'Links'},
];

function exportData(store: Store, kind: ExportKind): ExportData {
	return kind === 'sessions'
		? {kind, groups: store.groups, folders: store.folders}
		: {kind, columns: store.bookmarkColumns, bookmarks: store.bookmarks};
}

/**
One thing to export instead of the whole library: a session, a folder, a column, or some bookmarks.
*/
export type ExportScope = {title: string; data: ExportData};

let openScope: ExportScope | undefined;
const scopeListeners = new Set<() => void>();

/**
Opens the export drawer for one thing. `ExportHost`, mounted once near the root, draws it.
*/
export function openExport(scope: ExportScope | undefined): void {
	openScope = scope;
	for (const listener of scopeListeners) {
		listener();
	}
}

export function ExportHost() {
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
		<ExportSheet
			visible={scope !== undefined}
			scope={scope}
			onClose={() => {
				openExport(undefined);
			}}
		/>
	);
}

type ExportWhat = ExportKind | 'backup';

/**
Saves the library, or one part of it, as a file the person can keep or send: sessions or bookmarks in the formats the
extension exports, or everything as a backup ZIP the extension can restore, with an optional password.
*/
export function ExportSheet({
	visible,
	scope,
	onClose,
}: {
	visible: boolean;
	scope?: ExportScope;
	onClose: () => void;
}) {
	const colors = useColors();
	const store = useLibrary();
	const [what, setWhat] = useState<ExportWhat>('sessions');
	const [format, setFormat] = useState<ExportFormat>('json');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const sessions = store.groups.length;
	const bookmarks = store.bookmarks.length;
	const isBackup = scope === undefined && what === 'backup';
	const empty =
		scope === undefined &&
		!isBackup &&
		(what === 'sessions' ? sessions : bookmarks) === 0;
	const problem =
		isBackup && password !== ''
			? (validateCredential('password', password) ?? undefined)
			: undefined;
	const run = async () => {
		setBusy(true);
		try {
			if (isBackup) {
				const file = await buildBackup(store, APP_NAME, password);
				await shareBinaryFile(file.filename, file.mime, file.bytes);
			} else {
				const data = scope?.data ?? exportData(store, what as ExportKind);
				const file = buildExport(data, format, {appName: APP_NAME});
				await shareTextFile(file.filename, file.mime, file.content);
			}

			setPassword('');
			onClose();
		} catch {
			notify('Could not export', 'Try again.');
		} finally {
			setBusy(false);
		}
	};

	return (
		<BottomSheet visible={visible} label="Export" onClose={onClose}>
			<View style={styles.body}>
				<Title>{scope ? `Export ${scope.title}` : 'Export'}</Title>
				{scope === undefined && (
					<Chips
						items={[
							{id: 'sessions', name: 'Sessions', count: sessions},
							{id: 'bookmarks', name: 'Bookmarks', count: bookmarks},
							{id: 'backup', name: 'Everything'},
						]}
						selected={what}
						onSelect={(id) => {
							setWhat(id as ExportWhat);
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
						{password !== '' && (
							<Text style={{color: colors.muted}}>{LOST_CREDENTIAL_NOTE}</Text>
						)}
					</>
				) : (
					<Chips
						items={EXPORT_FORMAT_CHOICES}
						selected={format}
						onSelect={(id) => {
							setFormat(id as ExportFormat);
						}}
					/>
				)}
				<Button
					label="Export"
					icon="share-outline"
					disabled={empty || Boolean(problem)}
					loading={busy}
					onPress={() => void run()}
				/>
			</View>
		</BottomSheet>
	);
}

type ShareMethod = 'links' | 'markdown' | 'html';

const SHARE_METHODS: Array<{id: ShareMethod; name: string}> = [
	{id: 'links', name: 'Links'},
	{id: 'markdown', name: 'Markdown'},
	{id: 'html', name: 'HTML page'},
];

export type ShareTarget = {title: string; sessions: Session[]};

/**
Shares the links of a session, or of every session in a folder, as plain addresses, as a Markdown list, or as a web
page the receiver can open.
*/
export function ShareLinksSheet({
	target,
	onClose,
}: {
	target: ShareTarget | undefined;
	onClose: () => void;
}) {
	const colors = useColors();
	const [method, setMethod] = useState<ShareMethod>('links');
	const groups = useMemo(
		() => (target ? shareGroupsOf(target.sessions) : []),
		[target],
	);
	const run = async () => {
		if (!target) {
			return;
		}

		try {
			if (method === 'html') {
				await shareTextFile(
					`${target.title.replaceAll(/[^\w-]+/g, '-').slice(0, 40) || 'links'}.html`,
					'text/html',
					shareHtmlPage(target.title, groups, APP_NAME),
				);
			} else {
				await Share.share({
					title: target.title,
					message:
						method === 'markdown' ? shareMarkdown(groups) : shareLinks(groups),
				});
			}

			onClose();
		} catch {
			notify('Could not share', 'Try again.');
		}
	};

	return (
		<BottomSheet
			visible={target !== undefined}
			label="Share links"
			onClose={onClose}
		>
			<View style={styles.body}>
				<Title>Share links</Title>
				<Text style={{color: colors.muted}}>
					{shareCounts(groups).links} links from {target?.title}
				</Text>
				<Chips
					items={SHARE_METHODS}
					selected={method}
					onSelect={(id) => {
						setMethod(id as ShareMethod);
					}}
				/>
				<Button label="Share" icon="share-outline" onPress={() => void run()} />
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	body: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	title: {fontSize: 20, fontWeight: '700'},
	summary: {gap: 4},
});
