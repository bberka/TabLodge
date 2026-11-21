import {useMemo, useState, useSyncExternalStore} from 'react';
import {Share, StyleSheet, Text, View} from 'react-native';
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
import {LOST_CREDENTIAL_NOTE} from '../../../../extension/src/shared/passcode';
import type {Store} from '../../../../extension/src/shared/types';
import {BottomSheet} from '../../ui/bottom-sheet';
import {notify, showDialog} from '../../ui/dialog';
import {buildBackup} from '../../transfer/backup';
import {backupPasswordNote} from '../../transfer/backup-password';
import {useView} from '../../library/view';
import {shareBinaryFile, shareTextFile} from '../../transfer/files';
import {useLibrary} from '../../library/library-store';
import {uploadPage, useSharedPagesServer} from '../../library/shared-pages';
import {copyLink} from '../../platform/copy-link';
import {openLink} from '../../platform/open-links';
import {useColors} from '../../ui/theme';
import {shareGroupsOf} from '../../transfer/transfer';
import {Button, Chips, Field} from '../../ui/widgets';
import {allCopies} from '../../library/page-copies';
import {
	SharedPageRows,
	useSharedPageList,
} from '../settings/shared-pages-settings';

const APP_NAME = 'TabLodge';

export function Title({children}: {children: string}) {
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

function exportData(store: Store, kind: ExportKind): ExportData {
	return kind === 'sessions'
		? {kind, groups: store.groups, folders: store.folders}
		: {kind, columns: store.bookmarkColumns, bookmarks: store.bookmarks};
}

/**
One thing to share instead of the whole library: a session, a folder, a column, or some bookmarks.
*/
export type ShareScope = {
	title: string;
	data: ExportData;
	source?: string;
};

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
	{id: 'page', name: 'HTML page'},
	{id: 'markdown', name: 'Markdown'},
	{id: 'links', name: 'Plain links'},
	{id: 'json', name: 'JSON file'},
	{id: 'csv', name: 'CSV file'},
	{id: 'html', name: 'Browser bookmarks (HTML)'},
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
	const [way, setWay] = useState<Way>('page');
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
	const kind = data.kind === 'bookmarks' ? 'bookmarks' : 'sessions';
	const pageHtml = (url?: string) =>
		shareHtmlPage(title, groups, APP_NAME, {kind, sharedAt: Date.now(), url});
	const listed = useSharedPageList(
		visible && canUpload && scope?.source !== undefined,
	);
	const sourcePages = scope?.source
		? (listed.pages ?? []).filter((page) => page.source === scope.source)
		: [];
	const {problem, hint: weak} = backupPasswordNote(isBackup, password);
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
							pageHtml(),
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
			const page = await uploadPage(title, pageHtml, scope?.source);
			onClose();
			await copyLink(page.url);
			showDialog(
				'Link ready',
				`${page.url}\n\nThe link is copied. Anyone with it can open the page. Sharing again makes a new link. Delete old ones from Share or Shared pages.`,
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
				<Title>{scope ? `Share ${scope.title}` : 'Share and export'}</Title>
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
						<Text
							accessibilityLiveRegion="polite"
							style={{color: colors.muted, marginTop: weak ? 0 : -14}}
						>
							{weak ?? ''}
						</Text>
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
						label="Get a link"
						icon="cloud-upload-outline"
						kind="plain"
						disabled={busy}
						loading={uploading}
						onPress={() => void upload()}
					/>
				)}
				{sourcePages.length > 0 && (
					<>
						<Text
							accessibilityRole="header"
							style={[styles.subtitle, {color: colors.text}]}
						>
							Links to this {kind === 'bookmarks' ? 'column' : 'session'}
						</Text>
						<SharedPageRows pages={sourcePages} onDelete={listed.remove} />
					</>
				)}
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	body: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	title: {fontSize: 20, fontWeight: '700'},
	subtitle: {fontSize: 16, fontWeight: '600'},
});
