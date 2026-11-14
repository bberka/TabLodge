// The Find duplicate bookmarks dialog: lists addresses saved more than once on the bookmark board, lets the
// person pick the copy to keep in each, and removes the rest. Removed copies go to the trash and one Undo restores them.
import {useMemo, useState} from 'react';
import {Trash2} from 'lucide-react';
import {
	Badge,
	Button,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	RadioCard,
	RadioCardGroup,
} from '../shared/ui';
import {LoadMore} from '../shared/load-more';
import type {Bookmark, BookmarkColumn} from '../shared/types';
import {displayUrl} from '../shared/url-display';
import {plural, send, type ShowStatus} from './common';
import {findDuplicateBookmarks, removalIds} from './duplicate-bookmarks';

const GROUPS_PER_BATCH = 25;
/**
The most copies one removal can trash (the trash bin's item limit).
*/
const REMOVE_AT_ONCE = 500;

export function DuplicateBookmarksDialog({
	open,
	onOpenChange,
	bookmarks,
	columns,
	showStatus,
	onChanged,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	bookmarks: readonly Bookmark[];
	columns: readonly BookmarkColumn[];
	showStatus: ShowStatus;
	onChanged: () => unknown;
}) {
	const groups = useMemo(
		() => (open ? findDuplicateBookmarks(bookmarks) : []),
		[open, bookmarks],
	);
	const [keep, setKeep] = useState<ReadonlyMap<string, string>>(
		() => new Map(),
	);
	const [shown, setShown] = useState(GROUPS_PER_BATCH);
	const [busy, setBusy] = useState(false);
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setKeep(new Map());
			setShown(GROUPS_PER_BATCH);
		}
	}

	const columnNames = useMemo(
		() => new Map(columns.map((column) => [column.id, column.name])),
		[columns],
	);
	const extra = useMemo(() => removalIds(groups, keep), [groups, keep]);
	const batch = extra.slice(0, REMOVE_AT_ONCE);
	const dateFormat = useMemo(
		() => new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}),
		[],
	);

	async function remove() {
		if (busy || batch.length === 0) {
			return;
		}

		setBusy(true);
		try {
			const result = await send('REMOVE_DUPLICATE_BOOKMARKS', {
				bookmarkIds: batch,
			});
			if (!result?.ok) {
				showStatus(result?.error || 'Could not remove the copies.', true);
				await onChanged();
				return;
			}

			onOpenChange(false);
			await onChanged();
			const left = extra.length - batch.length;
			const {trashIds} = result;
			showStatus(
				`Removed ${plural(result.removed, 'duplicate bookmark')}.${left > 0 ? ` ${plural(left, 'more copy', 'more copies')} remain. Open Find duplicate bookmarks again to remove them.` : ''}`,
				false,
				{
					action: {
						label: 'Undo',
						async onClick() {
							for (const id of trashIds.toReversed()) {
								const restored = await send('RESTORE_TRASH', {id});
								if (!restored?.ok) {
									await onChanged();
									showStatus(
										restored?.error || 'Could not restore all bookmarks.',
										true,
									);
									return;
								}
							}

							await onChanged();
							showStatus(
								`${plural(trashIds.length, 'bookmark')} restored.`,
								false,
								{toast: true},
							);
						},
					},
				},
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="lg">
				<DialogHeader>
					<DialogTitle>Find duplicate bookmarks</DialogTitle>
					<DialogDescription>
						{groups.length === 0
							? 'Looks for web addresses saved more than once on the bookmark board.'
							: `${plural(groups.length, 'address', 'addresses')} saved more than once. Choose the copy to keep in each; the others move to the trash bin and can be restored.`}
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{groups.length === 0 ? (
						<p role="status" className="text-sm text-muted-foreground">
							No duplicate bookmarks. Every address on the board is saved once.
						</p>
					) : (
						<>
							<ul className="space-y-4" aria-label="Duplicate bookmarks">
								{groups.slice(0, shown).map((group) => (
									<li key={group.url} className="min-w-0">
										<p
											id={`duplicate-${group.copies[0].id}`}
											className="mb-1.5 text-sm font-medium wrap-anywhere"
										>
											{displayUrl(group.url)}
										</p>
										<RadioCardGroup
											aria-labelledby={`duplicate-${group.copies[0].id}`}
											value={keep.get(group.url) ?? group.keepId}
											onValueChange={(id) =>
												setKeep((current) =>
													new Map(current).set(group.url, id),
												)
											}
										>
											{group.copies.map((copy) => (
												<RadioCard
													key={copy.id}
													value={copy.id}
													title={copy.title || displayUrl(group.url)}
													badge={
														copy.id === group.keepId ? (
															<Badge variant="secondary">Oldest</Badge>
														) : undefined
													}
													description={`In ${columnNames.get(copy.columnId) ?? 'Unfiled'}, saved ${dateFormat.format(copy.createdAt)}`}
												/>
											))}
										</RadioCardGroup>
									</li>
								))}
							</ul>
							{groups.length > shown && (
								<LoadMore
									remaining={groups.length - shown}
									step={GROUPS_PER_BATCH}
									noun="addresses"
									autoLoad={false}
									onMore={() => setShown((count) => count + GROUPS_PER_BATCH)}
								/>
							)}
						</>
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{groups.length === 0 ? 'Close' : 'Cancel'}
					</Button>
					{groups.length > 0 && (
						<Button disabled={busy} onClick={() => void remove()}>
							<Trash2 aria-hidden="true" />
							{`Remove ${plural(extra.length, 'extra copy', 'extra copies')}`}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
