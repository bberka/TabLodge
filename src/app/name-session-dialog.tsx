import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
	type SyntheticEvent,
} from 'react';
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
	Label,
} from '../shared/ui';
import {send} from './common';
import {SESSION_NAME_MAX, typedSessionName} from './session-name';
import type {SaveScope, Settings} from './types';

/**
The "Name this session" form: one input, Cancel and Save. Used inside the in-page dialog and as the whole page of
the name prompt window the service worker opens for saves that started without a page.
*/
export function NameSessionForm({
	initialName = '',
	placeholder,
	busy = false,
	submitLabel = 'Save',
	selectOnFocus = false,
	plain = false,
	onSubmit,
	onCancel,
	children,
}: {
	initialName?: string;
	placeholder?: string;
	busy?: boolean;
	submitLabel?: string;
	selectOnFocus?: boolean;
	/**
	Render as a page of its own (the prompt window) instead of inside a dialog.
	*/
	plain?: boolean;
	/**
	The raw typed text; the caller applies the empty-means-default rule.
	*/
	onSubmit: (typed: string) => void;
	onCancel: () => void;
	children?: ReactNode;
}) {
	const [name, setName] = useState(initialName);
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		const input = inputRef.current;
		if (!input) {
			return;
		}

		input.focus();
		if (selectOnFocus) {
			input.select();
		}
	}, [selectOnFocus]);

	function submit(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!busy) {
			onSubmit(name);
		}
	}

	const input = (
		<div className="space-y-1.5">
			<Label htmlFor="name-session-input">Session name</Label>
			<Input
				ref={inputRef}
				autoFocus
				id="name-session-input"
				name="name"
				autoComplete="off"
				maxLength={SESSION_NAME_MAX}
				placeholder={placeholder}
				value={name}
				onChange={(event) => setName(event.target.value)}
			/>
		</div>
	);
	const buttons = (
		<>
			<Button type="button" variant="outline" onClick={onCancel}>
				Cancel
			</Button>
			<Button type="submit" disabled={busy}>
				{submitLabel}
			</Button>
		</>
	);
	if (plain) {
		return (
			<form className="flex flex-col gap-4 p-5" onSubmit={submit}>
				<div>
					<h1 className="text-base font-semibold">Name this session</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Leave it empty to use the default name.
					</p>
				</div>
				{input}
				{children}
				<div className="flex justify-end gap-2">{buttons}</div>
			</form>
		);
	}

	return (
		<form onSubmit={submit}>
			<DialogHeader>
				<DialogTitle>Name this session</DialogTitle>
				<DialogDescription>
					Leave it empty to use the default name.
				</DialogDescription>
			</DialogHeader>
			<DialogBody>
				{input}
				{children}
			</DialogBody>
			<DialogFooter>{buttons}</DialogFooter>
		</form>
	);
}

type Pending = {
	placeholder: string;
	resolve: (answer: {name?: string} | null) => void;
};

/**
Asks for a session name before a save started from a TabLodge page, when Settings says "Ask each time".
`ask(request)` resolves `{name}` (undefined when left empty: the worker then uses the fallback name), or `null`
when the dialog was cancelled, in which case nothing may be saved. Without the `ask` style it resolves at once.
Render `dialog` once in the page.
*/
export function useSessionNameAsk(settings: Partial<Settings> | undefined) {
	const [pending, setPending] = useState<Pending | null>(null);
	const pendingRef = useRef<Pending | null>(null);
	const askStyle = settings?.sessionNameStyle === 'ask';

	const ask = useCallback(
		async (
			request: {scope?: SaveScope; tabIds?: number[]} = {},
		): Promise<{name?: string} | null> => {
			if (!askStyle) {
				return {};
			}

			const preview = await send('PREVIEW_SESSION_NAME', request);
			// A stale setting in this page: the worker says whether to ask.
			if (preview?.ok && !preview.asks) {
				return {};
			}

			return new Promise((resolve) => {
				const next = {
					placeholder: preview?.ok ? preview.name : '',
					resolve,
				};
				pendingRef.current = next;
				setPending(next);
			});
		},
		[askStyle],
	);

	function finish(answer: {name?: string} | null) {
		pendingRef.current?.resolve(answer);
		pendingRef.current = null;
		setPending(null);
	}

	const dialog = (
		<Dialog
			open={pending !== null}
			onOpenChange={(open) => {
				if (!open) {
					finish(null);
				}
			}}
		>
			<DialogContent size="sm">
				{pending && (
					<NameSessionForm
						placeholder={pending.placeholder}
						onCancel={() => finish(null)}
						onSubmit={(typed) => finish({name: typedSessionName(typed)})}
					/>
				)}
			</DialogContent>
		</Dialog>
	);

	return {ask, dialog};
}
