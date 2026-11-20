import {
	useEffect,
	useId,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
	CircleAlert,
	CircleHelp,
	Plus,
	Power,
	RotateCcw,
	Trash2,
} from 'lucide-react';
import {
	Button,
	IconTooltip,
	Input,
	Label,
	Popover,
	PopoverContent,
	PopoverTrigger,
	RadioCard,
	RadioCardGroup,
	SelectItem,
} from '../shared/ui';
import type {SiteSourceStatus} from '../shared/types';
import {ColumnSelect} from './column-select';
import {send, type ShowStatus} from './common';
import {Favicon} from './favicon';
import {ColumnLabel} from './icon-label';
import {PROJECT} from './project';
import {removeSiteSource, turnOnSiteSources} from './site-source-access';
import {
	SITE_SOURCES,
	SITE_SOURCES_KEY,
	type SiteSource,
	type SiteSourceId,
} from './site-sources';
import {cn} from '@/lib/utils';

export const SOURCES_TITLE = 'Sources';
export const SOURCES_DESCRIPTION = `Save a link to ${PROJECT.name} when you save it on a site you add here. Each site asks for access to that site only.`;
export const SOURCES_WORDS = [
	'sources',
	'Add a site',
	'Remove',
	...SITE_SOURCES.flatMap((source) => [source.label, source.description]),
	'Twitter',
	'site access',
	'permission',
	'Save to',
	'column',
	`Save to ${PROJECT.name} only`,
	'keep saves off the site',
	'On in another browser',
	'Turn on',
	'sync',
];
// The Save to entry for the site's own column; Radix Select needs a non-empty value.
const SITE_COLUMN = 'site-column';

function noticeText(source: SiteSource, notice: SiteSourceStatus['notice']) {
	if (notice === 'revoked') {
		return `Off in this browser because it removed ${PROJECT.name}'s access to ${source.hosts[0]}. Allow it again, or remove the site.`;
	}

	return notice === 'unreadable'
		? `${PROJECT.name} can't read this page anymore, so your last save there was not added. The site may have changed.`
		: undefined;
}

/**
A site stays in the list while it is on here or in another browser, and after this browser took its access away, so
the notice can say so.
*/
const isListed = (status: SiteSourceStatus | undefined) =>
	status?.wanted === true ||
	status?.enabled === true ||
	status?.notice === 'revoked';

function matches(source: SiteSource, query: string) {
	const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
	const text = [source.label, source.description, ...source.hosts]
		.join(' ')
		.toLocaleLowerCase();
	return words.every((word) => text.includes(word));
}

/**
What Save to TabLodge only does and doesn't do, behind a help button so the row shows no standing tip.
*/
function KeepOffHelpButton({site}: {site: string}) {
	const label = `About saving on ${site}`;
	return (
		<Popover>
			<IconTooltip label={label}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 shrink-0 text-muted-foreground"
						aria-label={label}
					>
						<CircleHelp className="h-4 w-4" aria-hidden="true" />
					</Button>
				</PopoverTrigger>
			</IconTooltip>
			<PopoverContent
				align="start"
				aria-label={label}
				className="w-80 space-y-2 p-3 text-xs leading-5"
			>
				<p>
					With Save to {PROJECT.name} only, hold Shift as you click to save on{' '}
					{site} too. The notice in the page also offers Also save on {site}.
				</p>
				<p>
					If {PROJECT.name} can&apos;t read or save the item, the click goes on
					to {site}, so a save is never lost. {site}&apos;s keyboard shortcuts
					still save there.
				</p>
				<p className="text-muted-foreground">
					To save only on {site}, remove it from Sources.
				</p>
			</PopoverContent>
		</Popover>
	);
}

/**
The state behind Settings › Sources, shared by the Add a site button in the section header and the list below it.
*/
export function useSiteSources(showStatus: ShowStatus) {
	const [sources, setSources] = useState<SiteSourceStatus[]>();
	const [busy, setBusy] = useState<SiteSourceId>();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const privateWindow = Boolean(chrome.extension?.inIncognitoContext);

	useEffect(() => {
		let alive = true;
		const read = () => {
			void send('GET_SITE_SOURCES')
				.then((result) => {
					if (alive && result.ok) {
						setSources(result.sources);
					}
				})
				.catch(() => undefined);
		};

		// The worker writes a notice when the browser revokes access or a page cannot be read.
		const onChanged = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: string,
		) => {
			if (area === 'local' && Object.hasOwn(changes, SITE_SOURCES_KEY)) {
				read();
			}
		};

		read();
		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			alive = false;
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, []);

	const status = (source: SiteSource) =>
		sources?.find((entry) => entry.id === source.id);

	async function add(source: SiteSource) {
		// Before any await: the permission request must come straight from the click or key press.
		const request = turnOnSiteSources([source]);
		const wasOn = status(source)?.wanted === true;
		setBusy(source.id);
		try {
			const result = await request;
			if (!result.ok) {
				showStatus(result.error, true);
				return;
			}

			setSources(result.sources);
			showStatus(
				wasOn
					? `Turned on ${source.label} in this browser.`
					: `Added ${source.label}.`,
			);
		} finally {
			setBusy(undefined);
		}
	}

	async function remove(source: SiteSource) {
		setBusy(source.id);
		try {
			const result = await removeSiteSource(source);
			if (!result.ok) {
				showStatus(result.error, true);
				return;
			}

			setSources(result.sources);
			// The removed row held focus; the Add a site button is the nearest control that stays.
			triggerRef.current?.focus();
			showStatus(
				`Removed ${source.label}. ${PROJECT.name} no longer has access to ${source.hosts[0]}.`,
			);
		} finally {
			setBusy(undefined);
		}
	}

	async function chooseColumn(
		source: SiteSource,
		columnId: string | null,
		columnName: string,
	) {
		const result = await send('SET_SITE_SOURCE_COLUMN', {
			source: source.id,
			columnId,
		});
		if (!result.ok) {
			showStatus(result.error, true);
			return;
		}

		setSources(result.sources);
		showStatus(`${source.label} now saves to ${columnName}.`);
	}

	async function chooseKeepOff(source: SiteSource, keepOffSite: boolean) {
		const result = await send('SET_SITE_SOURCE_KEEP_OFF', {
			source: source.id,
			keepOffSite,
		});
		if (!result.ok) {
			showStatus(result.error, true);
			return;
		}

		setSources(result.sources);
		showStatus(
			keepOffSite
				? `Saves on ${source.column.name} now go to ${PROJECT.name} only.`
				: `Saves on ${source.column.name} now stay on ${source.column.name} and go to ${PROJECT.name}.`,
		);
	}

	return {
		sources,
		busy,
		triggerRef,
		privateWindow,
		status,
		add,
		remove,
		chooseColumn,
		chooseKeepOff,
	};
}

export type SiteSourcesController = ReturnType<typeof useSiteSources>;

/**
The Add a site button: a popover with a search field (a combobox) over the list of supported sites not added yet.
Arrow keys move through the list, Enter adds the highlighted site, and Escape closes it.
*/
export function AddSiteSource({
	controller,
}: {
	controller: SiteSourcesController;
}) {
	const {sources, triggerRef, privateWindow, status, add} = controller;
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);
	const listId = useId();
	const listRef = useRef<HTMLDivElement>(null);
	if (privateWindow) {
		return null;
	}

	const available = SITE_SOURCES.filter((source) => !isListed(status(source)));
	const shown = available.filter((source) => matches(source, query));
	const current = shown[Math.min(active, shown.length - 1)];

	function pick(source: SiteSource) {
		setOpen(false);
		setQuery('');
		void add(source);
	}

	function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
		const last = shown.length - 1;
		const next = {
			ArrowDown: Math.min(active + 1, last),
			ArrowUp: Math.max(active - 1, 0),
			Home: 0,
			End: last,
		}[event.key];
		if (next !== undefined) {
			event.preventDefault();
			setActive(Math.max(next, 0));
			// The list scrolls once it holds more sites than fit; keep the highlighted one in view.
			listRef.current?.children[Math.max(next, 0)]?.scrollIntoView({
				block: 'nearest',
			});
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (current) {
				pick(current);
			}
		}
	}

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				setQuery('');
				setActive(0);
			}}
		>
			<PopoverTrigger asChild>
				<Button
					ref={triggerRef}
					variant="outline"
					size="sm"
					disabled={!sources}
				>
					<Plus className="h-4 w-4" aria-hidden="true" />
					Add a site
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				<div className="border-b border-border p-2">
					<Input
						type="search"
						role="combobox"
						aria-label="Search supported sites"
						aria-expanded="true"
						aria-controls={listId}
						aria-autocomplete="list"
						aria-activedescendant={
							current ? `${listId}-${current.id}` : undefined
						}
						placeholder="Search sites"
						autoComplete="off"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActive(0);
						}}
						onKeyDown={onKeyDown}
					/>
				</div>
				<div
					ref={listRef}
					id={listId}
					role="listbox"
					aria-label="Supported sites"
					className="max-h-72 overflow-y-auto p-1"
				>
					{shown.map((source) => {
						const selected = source === current;
						return (
							<div
								key={source.id}
								id={`${listId}-${source.id}`}
								role="option"
								aria-selected={selected}
								className={cn(
									'flex cursor-pointer items-start gap-3 rounded-sm px-2 py-2',
									selected && 'bg-accent text-accent-foreground',
								)}
								onMouseMove={() => {
									setActive(shown.indexOf(source));
								}}
								onClick={() => {
									pick(source);
								}}
							>
								<Favicon
									url={source.homepage}
									label={source.label}
									className="mt-0.5 h-5 w-5 rounded-sm"
								/>
								<span className="min-w-0">
									<span className="block text-sm font-medium">
										{source.label}
									</span>
									<span
										className={cn(
											'block text-xs leading-5',
											selected
												? 'text-accent-foreground/80'
												: 'text-muted-foreground',
										)}
									>
										{source.description}
									</span>
								</span>
							</div>
						);
					})}
				</div>
				{shown.length === 0 && (
					<p className="px-3 pb-4 pt-2 text-center text-sm text-muted-foreground">
						{available.length === 0
							? 'Every supported site is added.'
							: 'No supported site matches.'}
					</p>
				)}
				<p className="sr-only" role="status" aria-live="polite">
					{`${shown.length} ${shown.length === 1 ? 'site' : 'sites'}`}
				</p>
			</PopoverContent>
		</Popover>
	);
}

export function SiteSourcesSettings({
	controller,
	columns,
}: {
	controller: SiteSourcesController;
	columns: ReadonlyArray<{
		id: string;
		name: string;
		icon?: string;
		color?: string;
	}>;
}) {
	const {
		sources,
		busy,
		privateWindow,
		status,
		add,
		remove,
		chooseColumn,
		chooseKeepOff,
	} = controller;

	if (privateWindow) {
		return (
			<p className="text-sm text-muted-foreground">
				Add or remove sites in a regular window. A save in a private window is
				added only when private windows use the regular library.
			</p>
		);
	}

	const listed = SITE_SOURCES.filter((source) => isListed(status(source)));
	if (sources && listed.length === 0) {
		return (
			<p className="rounded-md bg-muted px-3 py-3 text-sm text-muted-foreground">
				No sites added.
			</p>
		);
	}

	return (
		<div className="space-y-2">
			{listed.map((source) => {
				const entry = status(source);
				const notice = noticeText(source, entry?.notice);
				const labelId = `site-source-${source.id}`;
				const columnFieldId = `site-source-column-${source.id}`;
				const keepOffLabelId = `site-source-keep-off-${source.id}`;
				const site = source.column.name;
				// With no choice, or a chosen column that was deleted, saves go to the site's source column, made on the
				// first save.
				const siteColumn = columns.find(
					(column) => column.id === source.column.id,
				);
				const chosen = columns.some((column) => column.id === entry?.columnId)
					? entry?.columnId
					: (siteColumn?.id ?? SITE_COLUMN);
				return (
					<div
						key={source.id}
						data-site-source={source.id}
						role="group"
						aria-labelledby={labelId}
						className="rounded-md border border-border px-3 py-3"
					>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div className="flex min-w-0 items-start gap-3">
								<Favicon
									url={source.homepage}
									label={source.label}
									className="mt-0.5 h-5 w-5 rounded-sm"
								/>
								<div className="min-w-0">
									<p id={labelId} className="text-sm font-medium">
										{source.label}
									</p>
									<p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
										{source.description}
									</p>
									{!entry?.enabled && !notice && (
										<p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">
											On in another browser. Turn it on to save here too; the
											browser asks for access to {source.hosts[0]}.
										</p>
									)}
									{notice && (
										<p
											role="status"
											className="mt-2 flex max-w-xl items-start gap-1.5 text-xs leading-5 text-destructive"
										>
											<CircleAlert
												className="mt-0.5 h-3.5 w-3.5 shrink-0"
												aria-hidden="true"
											/>
											{notice}
										</p>
									)}
								</div>
							</div>
							<div className="flex shrink-0 gap-2 max-sm:justify-end">
								{!entry?.enabled && notice === 'revoked' && (
									<Button
										variant="outline"
										size="sm"
										disabled={busy !== undefined}
										aria-label={`Allow access to ${source.hosts[0]} again for ${source.label}`}
										onClick={() => void add(source)}
									>
										<RotateCcw className="h-4 w-4" aria-hidden="true" />
										Allow again
									</Button>
								)}
								{!entry?.enabled && notice !== 'revoked' && (
									<Button
										variant="outline"
										size="sm"
										disabled={busy !== undefined}
										aria-label={`Turn on ${source.label} in this browser`}
										onClick={() => void add(source)}
									>
										<Power className="h-4 w-4" aria-hidden="true" />
										Turn on
									</Button>
								)}
								<Button
									variant="ghost"
									size="sm"
									disabled={busy !== undefined}
									aria-label={`Remove ${source.label}`}
									onClick={() => void remove(source)}
								>
									<Trash2 className="h-4 w-4" aria-hidden="true" />
									Remove
								</Button>
							</div>
						</div>
						{entry?.enabled && (
							<div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
								<Label htmlFor={columnFieldId} className="text-sm font-medium">
									Save to
								</Label>
								<ColumnSelect
									id={columnFieldId}
									columns={columns}
									value={chosen}
									className="w-full sm:w-64"
									onValueChange={(value) => {
										const columnId = value === SITE_COLUMN ? null : value;
										void chooseColumn(
											source,
											columnId,
											columns.find((column) => column.id === columnId)?.name ??
												`the ${source.column.name} column`,
										);
									}}
								>
									{!siteColumn && (
										<SelectItem value={SITE_COLUMN}>
											<ColumnLabel
												column={{
													...source.column,
													name: `${source.column.name} (new)`,
												}}
											/>
										</SelectItem>
									)}
								</ColumnSelect>
							</div>
						)}
						{entry?.enabled && source.keepOffSite && (
							<div className="mt-3 border-t border-border pt-3">
								<div className="flex items-center gap-1">
									<p id={keepOffLabelId} className="text-sm font-medium">
										When you save on {site}
									</p>
									<KeepOffHelpButton site={site} />
								</div>
								<RadioCardGroup
									aria-labelledby={keepOffLabelId}
									className="mt-2 sm:grid-cols-2"
									value={entry.keepOffSite ? 'tablodge' : 'both'}
									onValueChange={(value) => {
										void chooseKeepOff(source, value === 'tablodge');
									}}
								>
									<RadioCard
										value="both"
										title={`Save on ${site} and in ${PROJECT.name}`}
										description={`${site} saves it as usual, and ${PROJECT.name} saves the same link.`}
									/>
									<RadioCard
										value="tablodge"
										title={`Save to ${PROJECT.name} only`}
										description={`${site} doesn't save it or show it as saved.`}
									/>
								</RadioCardGroup>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
