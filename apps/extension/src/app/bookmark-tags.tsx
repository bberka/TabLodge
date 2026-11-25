import {Plus, Tags, X} from 'lucide-react';
import {useRef, useState} from 'react';
import {
	MAX_TAGS,
	parseTagInput,
	shownTags,
	tagCounts,
} from '../shared/bookmark-tags';
import {linkKind} from '../shared/link-kind';
import {parseSearchQuery, toggleTagFilter} from '../shared/search-query';
import type {Bookmark} from '../shared/types';
import {
	Button,
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
	IconTooltip,
	Input,
	Label,
	ScrollArea,
} from '../shared/ui';
import {cn} from '@/lib/utils';

type Tagged = Pick<Bookmark, 'url' | 'tags' | 'hiddenKinds'>;

const chip =
	'inline-flex max-w-full items-center truncate rounded-full bg-muted px-1.5 outline outline-1 outline-transparent text-[0.625rem] leading-[1.6] text-muted-foreground';

export function TagChips({
	bookmark,
	className,
}: {
	bookmark: Tagged;
	className?: string;
}) {
	const tags = shownTags(bookmark);
	if (tags.length === 0) {
		return null;
	}

	return (
		<p className={cn('flex min-w-0 flex-wrap gap-1', className)}>
			<span className="sr-only">Tags: </span>
			{tags.map((tag) => (
				<span key={tag} className={chip}>
					{tag}
				</span>
			))}
		</p>
	);
}

export function TagFilterMenu({
	bookmarks,
	search,
	onSearch,
}: {
	bookmarks: readonly Tagged[];
	search: string;
	onSearch: (search: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const counts = open ? tagCounts(bookmarks) : [];
	const active = parseSearchQuery(search).tags;
	const label =
		active.length > 0 ? `Filter by tag (${active.length} on)` : 'Filter by tag';
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<IconTooltip label={label}>
				<DropdownMenuTrigger asChild>
					<Button
						variant={active.length > 0 ? 'secondary' : 'ghost'}
						size="icon"
						className="h-8 w-8"
						aria-label={label}
					>
						<Tags />
					</Button>
				</DropdownMenuTrigger>
			</IconTooltip>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuLabel>Filter by tag</DropdownMenuLabel>
				{counts.length === 0 ? (
					<DropdownMenuItem disabled>No tags yet</DropdownMenuItem>
				) : (
					<ScrollArea type="auto" viewportClassName="max-h-72">
						{counts.map(({tag, count}) => (
							<DropdownMenuCheckboxItem
								key={tag}
								checked={active.includes(tag)}
								onSelect={(event) => {
									event.preventDefault();
								}}
								onCheckedChange={() => {
									onSearch(toggleTagFilter(search, tag));
								}}
							>
								<span className="min-w-0 flex-1 truncate">{tag}</span>
								<span className="ml-2 text-xs tabular-nums text-muted-foreground">
									{count}
								</span>
							</DropdownMenuCheckboxItem>
						))}
					</ScrollArea>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export type TagEdit = Pick<Bookmark, 'tags' | 'hiddenKinds'>;

export function TagsField({
	id,
	url,
	value,
	onChange,
}: {
	id: string;
	url: string;
	value: TagEdit;
	onChange: (value: TagEdit) => void;
}) {
	const [draft, setDraft] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const own = value.tags ?? [];
	const hidden = value.hiddenKinds ?? [];
	const kind = linkKind(url);
	const automatic = kind === 'page' ? undefined : kind;
	const kindHidden = automatic !== undefined && hidden.includes(automatic);
	const full = own.length >= MAX_TAGS;

	const setKindHidden = (next: boolean) => {
		const others = hidden.filter((entry) => entry !== automatic);
		onChange({
			tags: next ? own.filter((tag) => tag !== automatic) : own,
			hiddenKinds: next && automatic ? [...others, automatic] : others,
		});
	};

	const commit = (text: string) => {
		const added = parseTagInput(text).filter((tag) => !own.includes(tag));
		if (added.length > 0) {
			onChange({...value, tags: [...own, ...added].slice(0, MAX_TAGS)});
		}

		setDraft('');
	};

	const remove = (tag: string) => {
		onChange({...value, tags: own.filter((entry) => entry !== tag)});
		inputRef.current?.focus();
	};

	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>Tags</Label>
			<div
				ref={boxRef}
				className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 focus-within:ring-2 focus-within:ring-ring"
			>
				{automatic && !kindHidden && (
					<TagToken
						label={automatic}
						title="Worked out from the address"
						buttonLabel={`Remove automatic tag ${automatic}`}
						onRemove={() => {
							setKindHidden(true);
							inputRef.current?.focus();
						}}
					/>
				)}
				{own
					.filter((tag) => tag !== automatic || kindHidden)
					.map((tag) => (
						<TagToken
							key={tag}
							label={tag}
							buttonLabel={`Remove tag ${tag}`}
							onRemove={() => {
								remove(tag);
							}}
						/>
					))}
				<Input
					ref={inputRef}
					id={id}
					value={draft}
					disabled={full}
					placeholder={full ? `Up to ${MAX_TAGS} tags` : 'Add a tag'}
					className="h-7 min-w-24 flex-1 border-0 px-1 text-sm shadow-none focus-visible:ring-0"
					onChange={(event) => {
						const text = event.target.value;
						if (text.includes(',')) {
							commit(text);
						} else {
							setDraft(text);
						}
					}}
					onBlur={() => {
						commit(draft);
					}}
					onKeyDown={(event) => {
						if (event.key !== 'Enter' || draft.trim() === '') {
							return;
						}

						event.preventDefault();
						commit(draft);
					}}
				/>
			</div>
			{kindHidden && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-xs"
					onClick={() => {
						setKindHidden(false);
						requestAnimationFrame(() => {
							const target = inputRef.current?.disabled
								? boxRef.current?.querySelector<HTMLButtonElement>('button')
								: inputRef.current;
							target?.focus();
						});
					}}
				>
					<Plus className="h-3.5 w-3.5" />
					Show automatic tag {automatic}
				</Button>
			)}
		</div>
	);
}

function TagToken({
	label,
	title,
	buttonLabel,
	onRemove,
}: {
	label: string;
	title?: string;
	buttonLabel: string;
	onRemove: () => void;
}) {
	return (
		<span
			title={title}
			className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-muted py-0.5 pl-2 pr-0.5 text-xs"
		>
			<span className="truncate">{label}</span>
			<button
				type="button"
				aria-label={buttonLabel}
				className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
				onClick={onRemove}
			>
				<X className="h-3.5 w-3.5" />
			</button>
		</span>
	);
}
