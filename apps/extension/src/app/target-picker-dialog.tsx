import {useId, useMemo, useState} from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';
import {Check, Plus, Search, X} from 'lucide-react';
import {
	Button,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	ScrollArea,
} from '../shared/ui';
import {ColumnLabel, FolderLabel} from './icon-label';
import {plural} from './plural';
import {
	filterPickerRows,
	indexPickerTargets,
	isCurrentPickerRow,
	stepPickerRow,
	type PickerRow,
	type PickerTarget,
} from './target-picker-rows';
import {VIRTUAL_OVERSCAN} from './virtual-rows';
import {cn} from '@/lib/utils';

export {type PickerTarget} from './target-picker-rows';

const ROW_HEIGHT = 36;
const LIST_PADDING = 4;
const VIEWPORT_HEIGHT = 288;

export type TargetPickerRequest = {
	title: string;
	description: string;
	kind: 'session' | 'folder' | 'column';
	targets: readonly PickerTarget[];
	currentId?: string;
	onPick: (target: PickerTarget) => void;
	create?: {label: string; run: (name: string) => void};
};

export function TargetPickerDialog({
	request,
	onClose,
}: {
	request: TargetPickerRequest | null;
	onClose: () => void;
}) {
	return (
		<Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent size="sm">
				{request && <PickerBody request={request} onClose={onClose} />}
			</DialogContent>
		</Dialog>
	);
}

function PickerBody({
	request,
	onClose,
}: {
	request: TargetPickerRequest;
	onClose: () => void;
}) {
	const {title, description, kind, targets, currentId, onPick, create} =
		request;
	const [query, setQuery] = useState('');
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
	const listId = useId();
	const indexed = useMemo(() => indexPickerTargets(targets), [targets]);
	const rows = useMemo(
		() => filterPickerRows(indexed, query, currentId, Boolean(create)),
		[indexed, query, currentId, create],
	);
	const firstChoice = rows.findIndex((row) => !isCurrentPickerRow(row));
	const active = Math.min(
		activeIndex ?? Math.max(firstChoice, 0),
		Math.max(rows.length - 1, 0),
	);
	const activeRow = rows[active];
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => viewport,
		estimateSize: () => ROW_HEIGHT,
		overscan: VIRTUAL_OVERSCAN,
		paddingStart: LIST_PADDING,
		paddingEnd: LIST_PADDING,
		getItemKey(index) {
			const row = rows[index];
			return row?.type === 'create' ? 'create' : (row?.target.id ?? index);
		},
		initialRect: {width: 0, height: VIEWPORT_HEIGHT},
	});
	const virtualItems = virtualizer.getVirtualItems();
	const activeMounted =
		activeRow !== undefined &&
		virtualItems.some((item) => item.index === active);

	function choose(row: PickerRow | undefined) {
		if (!row || isCurrentPickerRow(row)) {
			return;
		}

		onClose();
		if (row.type === 'create') {
			create?.run(row.name);
		} else {
			onPick(row.target);
		}
	}

	function step(direction: 1 | -1) {
		const next = stepPickerRow(rows, active, direction);
		if (next === null) {
			return;
		}

		setActiveIndex(next);
		virtualizer.scrollToIndex(next, {align: 'auto'});
	}

	const status =
		rows.length === 0 || rows[0]?.type === 'create'
			? `No ${kind} matches.`
			: `${plural(rows.length, kind)} found`;
	return (
		<>
			<DialogHeader>
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
			</DialogHeader>
			<DialogBody>
				<label className="relative block">
					<span className="sr-only">Search {kind}s</span>
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						data-autofocus
						type="text"
						role="combobox"
						aria-expanded="true"
						aria-controls={listId}
						aria-autocomplete="list"
						aria-activedescendant={
							activeMounted ? `${listId}-${active}` : undefined
						}
						autoComplete="off"
						className="pl-8"
						placeholder={`Search ${kind}s`}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActiveIndex(null);
							virtualizer.scrollToOffset(0);
						}}
						onKeyDown={(event) => {
							if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
								event.preventDefault();
								step(event.key === 'ArrowDown' ? 1 : -1);
							} else if (event.key === 'Enter') {
								event.preventDefault();
								choose(activeRow);
							}
						}}
					/>
				</label>
				<span role="status" className="sr-only">
					{status}
				</span>
				<ScrollArea
					viewportRef={setViewport}
					className="h-72 rounded-md border border-border"
				>
					<div
						id={listId}
						role="listbox"
						aria-label={`${title}, ${kind}s`}
						className="relative"
						style={
							rows.length > 0 ? {height: virtualizer.getTotalSize()} : undefined
						}
					>
						{virtualItems.map((item) => {
							const row = rows[item.index];
							if (!row) {
								return null;
							}

							const selected = item.index === active;
							const id = `${listId}-${item.index}`;
							const current = isCurrentPickerRow(row);
							return (
								<div
									key={item.key}
									id={id}
									role="option"
									aria-selected={selected}
									aria-disabled={current || undefined}
									aria-posinset={item.index + 1}
									aria-setsize={rows.length}
									style={{
										position: 'absolute',
										top: 0,
										left: LIST_PADDING,
										right: LIST_PADDING,
										height: ROW_HEIGHT,
										transform: `translateY(${item.start}px)`,
									}}
									className={cn(
										'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm',
										selected && 'bg-accent text-accent-foreground',
										current && 'cursor-not-allowed text-muted-foreground',
									)}
									onMouseMove={() => !current && setActiveIndex(item.index)}
									onClick={() => choose(row)}
								>
									{row.type === 'create' ? (
										<span className="flex min-w-0 items-center gap-2">
											<Plus
												aria-hidden="true"
												className="h-4 w-4 shrink-0 text-muted-foreground"
											/>
											<span className="min-w-0 truncate">
												{create?.label} “{row.name}”
											</span>
										</span>
									) : (
										<>
											<TargetLabel kind={kind} target={row.target} />
											{current && (
												<span className="flex shrink-0 items-center gap-1 text-xs">
													<Check aria-hidden="true" className="h-3.5 w-3.5" />
													Current
												</span>
											)}
										</>
									)}
								</div>
							);
						})}
					</div>
					{rows.length === 0 && (
						<p className="px-3 py-10 text-center text-sm text-muted-foreground">
							No {kind} matches.
						</p>
					)}
				</ScrollArea>
				{firstChoice === -1 && rows.length > 0 && (
					<p className="text-xs text-muted-foreground">
						Only the current {kind} matches.
					</p>
				)}
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onClose}>
					<X aria-hidden="true" />
					Cancel
				</Button>
			</DialogFooter>
		</>
	);
}

function TargetLabel({
	kind,
	target,
}: {
	kind: TargetPickerRequest['kind'];
	target: PickerTarget;
}) {
	if (kind === 'folder') {
		return <FolderLabel folder={target} />;
	}

	return kind === 'column' ? (
		<ColumnLabel column={target} />
	) : (
		<span className="min-w-0 truncate">{target.name}</span>
	);
}
