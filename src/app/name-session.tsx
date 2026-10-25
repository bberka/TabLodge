import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TooltipProvider} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider} from '../shared/theme';
import {send} from './common';
import {NameSessionForm} from './name-session-dialog';
import {
	baseSessionName,
	numberedSessionNames,
	promptGroupIds,
	typedSessionName,
} from './session-name';

// The small window the service worker opens after a save that started without a page (shortcut, right-click menu,
// toolbar button) when Settings says "Ask each time". The sessions already exist with the fallback name; Save
// renames them, and Cancel, Escape or closing the window keeps that name.
function NameSessionPrompt() {
	const ids = promptGroupIds(location.search);
	const [initialName, setInitialName] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	// Escape keeps the default name, like closing the window.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				window.close();
			}
		};

		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, []);

	useEffect(() => {
		let current = true;
		void (async () => {
			const state = await send('GET_STATE');
			const first = state?.ok
				? state.groups.find((group) => group.id === ids[0])
				: undefined;
			if (current) {
				setInitialName(first ? baseSessionName(first.name) : '');
			}
		})();

		return () => {
			current = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- ids come from the address and never change
	}, []);

	async function save(typed: string) {
		const name = typedSessionName(typed);
		// Left empty (or unchanged): the default name stays.
		if (!name || name === initialName || ids.length === 0) {
			window.close();
			return;
		}

		setBusy(true);
		setError('');
		const names = numberedSessionNames(name, ids.length);
		for (const [index, groupId] of ids.entries()) {
			const result = await send('UPDATE_GROUP', {
				groupId,
				fields: {name: names[index]},
			});
			if (!result?.ok) {
				setBusy(false);
				setError(result?.error || 'Could not rename this session.');
				return;
			}
		}

		window.close();
	}

	if (initialName === null) {
		return null;
	}

	return (
		<main data-brand="tablodge" className="min-h-screen bg-background">
			<NameSessionForm
				plain
				selectOnFocus
				initialName={initialName}
				busy={busy}
				onCancel={() => window.close()}
				onSubmit={(typed) => void save(typed)}
			>
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
			</NameSessionForm>
		</main>
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<TooltipProvider>
			<NameSessionPrompt />
		</TooltipProvider>
	</ThemeProvider>,
);
