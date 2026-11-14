import {useEffect, useState, type SyntheticEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {Plus, Save, X} from 'lucide-react';
import {Button, Input, Label, SelectItem, TooltipProvider} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider} from '../shared/theme';
import type {ActionResult} from '../shared/types';
import {PrivateWindowAppearance} from './private-window-appearance';
import {PrivateLockGate} from './private-lock-ui';
import {LoadingLine, send, useCloseOnEscape} from './common';
import {LinkSummary} from './favicon';
import {IconLabel} from './icon-label';
import {IconNameField} from './icon-picker';
import {DEFAULT_COLUMN_ICON} from './icon-registry';
import {ColumnSelect} from './column-select';

type PromptRequest = Promise<ActionResult<'GET_BOOKMARK_PROMPT'> | undefined>;

// Extension/add-bookmark-preload.ts starts this read from the page head, while the bundle loads.
const preloaded = (
	globalThis as unknown as {__tablodgeBookmarkPrompt?: PromptRequest}
).__tablodgeBookmarkPrompt;
const RETRY_DELAYS_MS = [150, 300, 600, 1000, 1500];

const wait = async (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

// The service worker may still be waking up, so an empty answer is retried quietly.
function useBookmarkPrompt(url: string) {
	const [prompt, setPrompt] = useState<
		Extract<ActionResult<'GET_BOOKMARK_PROMPT'>, {ok: true}> | undefined
	>();
	const [error, setError] = useState('');
	useEffect(() => {
		let active = true;
		void (async () => {
			let result = await preloaded;
			for (
				let attempt = 0;
				!result && attempt < RETRY_DELAYS_MS.length;
				attempt += 1
			) {
				await wait(RETRY_DELAYS_MS[attempt]);
				result = await send('GET_BOOKMARK_PROMPT', {url});
			}

			if (!active) {
				return;
			}

			if (result?.ok) {
				setPrompt(result);
			} else {
				setError(result?.error || 'TabLodge could not load saved data.');
			}
		})();

		return () => {
			active = false;
		};
	}, [url]);
	return {prompt, error};
}

const NEW_COLUMN = '__new-column__';

// The small window the service worker opens for the "Bookmark this page" shortcut. The page and its title arrive in
// the address; Save adds the bookmark (creating the column first when asked) and closes the window, while Cancel,
// Escape or closing it saves nothing.
function AddBookmarkPrompt() {
	const params = new URLSearchParams(location.search);
	const url = params.get('url') || '';
	const fromBrowser = params.get('source') === 'browser';
	const {prompt, error: stateError} = useBookmarkPrompt(url);
	const [title, setTitle] = useState(params.get('title') || url);
	const [columnId, setColumnId] = useState('');
	const [newName, setNewName] = useState('');
	const [newIcon, setNewIcon] = useState<string | undefined>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	useCloseOnEscape();

	if (!prompt) {
		return stateError ? (
			<p role="alert" className="p-5 text-sm text-destructive">
				{stateError}
			</p>
		) : (
			<main className="min-h-screen p-5" aria-busy="true">
				<LoadingLine />
			</main>
		);
	}

	const columns = prompt.bookmarkColumns;
	const selected = columnId || prompt.defaultColumnId || NEW_COLUMN;
	const existingColumn = columns.find(
		(column) => column.id === prompt.existingColumnId,
	);

	async function save(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) {
			return;
		}

		setBusy(true);
		setError('');
		let target = selected;
		if (target === NEW_COLUMN) {
			const created = await send('CREATE_BOOKMARK_COLUMN', {
				name: newName.trim(),
				icon: newIcon,
			});
			if (!created?.ok) {
				setBusy(false);
				setError(created?.error || 'Could not create that column.');
				return;
			}

			target = created.column.id;
		}

		const result = await send('ADD_BOOKMARK', {
			bookmark: {title, url, columnId: target},
		});
		if (!result?.ok) {
			setBusy(false);
			setError(result?.error || 'Could not bookmark this page.');
			return;
		}

		window.close();
	}

	return (
		<main className="min-h-screen">
			<form className="flex flex-col gap-4 p-5" onSubmit={(e) => void save(e)}>
				<div>
					<h1 className="text-base font-semibold">Bookmark this page</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{fromBrowser
							? 'You bookmarked this page in the browser. Add it to TabLodge too?'
							: 'Save it to a local column.'}
					</p>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="add-bookmark-title">Title</Label>
					<Input
						autoFocus
						required
						id="add-bookmark-title"
						maxLength={500}
						autoComplete="off"
						value={title}
						onFocus={(event) => event.target.select()}
						onChange={(event) => setTitle(event.target.value)}
					/>
				</div>
				<LinkSummary url={url} settings={prompt.settings} />
				<div className="space-y-1.5">
					<Label htmlFor="add-bookmark-column">Column</Label>
					<ColumnSelect
						columns={columns}
						value={selected}
						id="add-bookmark-column"
						onValueChange={setColumnId}
					>
						<SelectItem value={NEW_COLUMN}>
							<IconLabel icon={Plus}>New column</IconLabel>
						</SelectItem>
					</ColumnSelect>
					{existingColumn && (
						<p className="text-xs text-muted-foreground">
							Already in “{existingColumn.name}”.
						</p>
					)}
				</div>
				{selected === NEW_COLUMN && (
					<IconNameField
						id="add-bookmark-new-column"
						label="New column name"
						nameLabel="New column name"
						icon={newIcon}
						defaultIcon={DEFAULT_COLUMN_ICON}
						inputProps={{
							required: true,
							maxLength: 60,
							placeholder: 'Reading list',
							autoFocus: true,
							value: newName,
							onChange: (event) => setNewName(event.target.value),
						}}
						onIconChange={setNewIcon}
					/>
				)}
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
				<div className="flex flex-wrap justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() => window.close()}
					>
						<X aria-hidden="true" />
						Cancel
					</Button>
					<Button type="submit" disabled={busy}>
						<Save aria-hidden="true" />
						Save
					</Button>
				</div>
			</form>
		</main>
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<PrivateWindowAppearance>
			<TooltipProvider>
				<PrivateLockGate>
					<AddBookmarkPrompt />
				</PrivateLockGate>
			</TooltipProvider>
		</PrivateWindowAppearance>
	</ThemeProvider>,
);
