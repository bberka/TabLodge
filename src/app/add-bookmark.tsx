import {useState, type SyntheticEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {Plus} from 'lucide-react';
import {Button, Input, Label, SelectItem, TooltipProvider} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider} from '../shared/theme';
import {send, useCloseOnEscape, useTabLodgeState} from './common';
import {LinkSummary} from './favicon';
import {IconLabel} from './icon-label';
import {IconNameField} from './icon-picker';
import {DEFAULT_COLUMN_ICON} from './icon-registry';
import {ColumnSelect} from './column-select';

const NEW_COLUMN = '__new-column__';

// The small window the service worker opens for the "Bookmark this page" shortcut. The page and its title arrive in
// the address; Save adds the bookmark (creating the column first when asked) and closes the window, while Cancel,
// Escape or closing it saves nothing.
function AddBookmarkPrompt() {
	const params = new URLSearchParams(location.search);
	const url = params.get('url') || '';
	const fromBrowser = params.get('source') === 'browser';
	const {state, error: stateError} = useTabLodgeState();
	const [title, setTitle] = useState(params.get('title') || url);
	const [columnId, setColumnId] = useState('');
	const [newName, setNewName] = useState('');
	const [newIcon, setNewIcon] = useState<string | undefined>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	useCloseOnEscape();

	if (!state) {
		return stateError ? (
			<p role="alert" className="p-5 text-sm text-destructive">
				{stateError}
			</p>
		) : null;
	}

	const columns = state.bookmarkColumns;
	const selected = columnId || columns[0]?.id || NEW_COLUMN;
	const existing = state.bookmarks.find((bookmark) => bookmark.url === url);
	const existingColumn = existing
		? columns.find((column) => column.id === existing.columnId)
		: undefined;

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
		<main data-brand="tablodge" className="min-h-screen bg-background">
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
				<LinkSummary url={url} settings={state.settings} />
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
					{existing && existingColumn && (
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
				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() => window.close()}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={busy}>
						Save
					</Button>
				</div>
			</form>
		</main>
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<TooltipProvider>
			<AddBookmarkPrompt />
		</TooltipProvider>
	</ThemeProvider>,
);
