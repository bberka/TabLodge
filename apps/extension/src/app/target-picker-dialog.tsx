import {useEffect, useId, useMemo, useRef, useState} from 'react';
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
import {cn} from '@/lib/utils';

export type PickerTarget = {
	id: string;
	name: string;
	icon?: string;
	color?: string;
};

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

type Row =
	| {type: 'target'; target: PickerTarget; current: boolean}
	| {type: 'create'; name: string};

const isCurrent = (row: Row | undefined) =>
	row?.type === 'target' && row.current;

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
	const listId = useId();
	const activeRef = useRef<HTMLDivElement | null>(null);
	const needle = query.trim().toLowerCase();
	const rows = useMemo<Row[]>(() => {
		const matches = targets
			.filter((target) => target.name.toLowerCase().includes(needle))
			.map((target): Row => ({
				type: 'target',
				target,
				current: target.id === currentId,
			}));
		return matches.length === 0 && create && needle
			? [{type: 'create', name: query.trim()}]
			: matches;
	}, [targets, currentId, create, needle, query]);
	const firstChoice = rows.findIndex((row) => !isCurrent(row));
	const active = Math.min(
		activeIndex ?? Math.max(firstChoice, 0),
		Math.max(rows.length - 1, 0),
	);
	const activeRow = rows[active];
	useEffect(() => {
		activeRef.current?.scrollIntoView({block: 'nearest'});
	}, [active, rows]);

	function choose(row: Row | undefined) {
		if (!row || isCurrent(row)) {
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
		let next = active + direction;
		while (isCurrent(rows[next])) {
			next += direction;
		}

		if (next >= 0 && next < rows.length) {
			setActiveIndex(next);
		}
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
							activeRow ? `${listId}-${active}` : undefined
						}
						autoComplete="off"
						className="pl-8"
						placeholder={`Search ${kind}s`}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActiveIndex(null);
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
				<ScrollArea className="h-72 rounded-md border border-border">
					<div
						id={listId}
						role="listbox"
						aria-label={`${title}, ${kind}s`}
						className="p-1"
					>
						{rows.map((row, index) => {
							const selected = index === active;
							const id = `${listId}-${index}`;
							const current = isCurrent(row);
							return (
								<div
									key={row.type === 'create' ? 'create' : row.target.id}
									ref={selected ? activeRef : undefined}
									id={id}
									role="option"
									aria-selected={selected}
									aria-disabled={current || undefined}
									className={cn(
										'flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm',
										selected && 'bg-accent text-accent-foreground',
										current && 'cursor-not-allowed text-muted-foreground',
									)}
									onMouseMove={() => !current && setActiveIndex(index)}
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
