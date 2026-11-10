// Moving library content into the locked area: bookmarks, a whole column, or the links of a saved session. One
// confirmation says what happens, asks for the PIN or password when the area is locked, and sends a single
// LOCKED_MOVE_IN message. The worker does the work; this page never sees the decrypted area.
import {useEffect, useId, useRef, useState, type SyntheticEvent} from 'react';
import {Lock, LockOpen, X} from 'lucide-react';
import {
	Button,
	Checkbox,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Label,
	RadioCard,
	RadioCardGroup,
} from '../shared/ui';
import type {ActionFailure, LockedMoveResult, LockedMoveSource} from './types';
import {PasscodeEntry} from './passcode-fields';
import {PROJECT} from './project';
import {plural, send, type ShowStatus} from './common';
import {
	ErrorLine,
	Note,
	failureText,
	openLockedSetup,
	useCooldown,
	useLockedStatus,
} from './locked';

/**
What the dialog was opened for. `source` carries the ids; the names and counts are only for the words on screen.
*/
export type LockedMoveRequest =
	| {kind: 'bookmarks'; ids: string[]}
	| {kind: 'column'; columnId: string; name: string; count: number}
	| {kind: 'session'; groupId: string; name: string; count: number};

type Afterwards = 'keep' | 'delete';

export function lockedMoveCount(request: LockedMoveRequest): number {
	return request.kind === 'bookmarks' ? request.ids.length : request.count;
}

function sourceOf(
	request: LockedMoveRequest,
	afterwards: Afterwards,
): LockedMoveSource {
	switch (request.kind) {
		case 'bookmarks': {
			return {kind: 'bookmarks', ids: request.ids};
		}

		case 'column': {
			return {kind: 'column', columnId: request.columnId};
		}

		case 'session': {
			return {kind: 'session', groupId: request.groupId, afterwards};
		}
	}
}

/**
The sentence shown in the toast after a move, with every count the worker reported.
*/
export function lockedMoveSummary(
	result: LockedMoveResult,
	request: LockedMoveRequest,
	afterwards: Afterwards,
): string {
	const parts: string[] = [];
	if (request.kind === 'session' && afterwards === 'keep') {
		parts.push(
			`Copied ${plural(result.copied, 'link')} to the locked area. The session was kept.`,
		);
	} else {
		parts.push(
			`Moved ${plural(result.removed, request.kind === 'session' ? 'link' : 'bookmark')} to the locked area.`,
		);
	}

	const alreadyThere = result.copied - result.added;
	if (alreadyThere > 0) {
		parts.push(
			`${alreadyThere} ${alreadyThere === 1 ? 'was' : 'were'} already there.`,
		);
	}

	if (
		result.left > 0 &&
		!(request.kind === 'session' && afterwards === 'keep')
	) {
		parts.push(
			`${plural(result.left, 'link')} changed meanwhile and ${result.left === 1 ? 'stays' : 'stay'} where ${result.left === 1 ? 'it is' : 'they are'}.`,
		);
	}

	if (result.copiesDeleted > 0) {
		parts.push(
			`Deleted ${plural(result.copiesDeleted, 'saved copy', 'saved copies')} (backups and snapshots).`,
		);
	}

	if (!result.cleaned) {
		parts.push(
			'An old copy could not be removed yet; it goes with your next change.',
		);
	}

	return parts.join(' ');
}

/**
What the move does, in the order it happens, and what it cannot reach.
*/
function MoveExplanation({
	request,
	keeping,
	links,
}: {
	request: LockedMoveRequest;
	keeping: boolean;
	links: string;
}) {
	return (
		<>
			<ul className="list-disc space-y-1.5 pl-5 text-sm leading-5">
				<li>
					{keeping
						? `${links} will be copied into the encrypted locked area.`
						: `${links} will be added to the encrypted locked area first, then removed from ${request.kind === 'session' ? 'the session' : 'the board'}.`}
				</li>
				{request.kind === 'column' && (
					<li>
						The locked area has no columns, so the bookmarks move without
						grouping. The column “{request.name}” is removed, and its name is
						not kept.
					</li>
				)}
				{request.kind === 'session' && !keeping && (
					<li>
						The session name and notes are not kept. Only titles and addresses
						move.
					</li>
				)}
				{!keeping && (
					<li>
						Nothing goes to the trash bin, and the Undo list is cleared, so no
						readable copy stays in {PROJECT.name}. You can move links back from
						the locked area.
					</li>
				)}
			</ul>
			<Note>
				Backups, exports, and files you already saved, and your browser history,
				keep readable copies. {PROJECT.name} cannot change those. Its own
				automatic backups and recovery snapshots may hold these links too.
			</Note>
		</>
	);
}

function MoveForm({
	request,
	showStatus,
	onSetup,
	onCancel,
	onDone,
}: {
	request: LockedMoveRequest;
	showStatus: ShowStatus;
	onSetup: () => void;
	onCancel: () => void;
	onDone: () => void;
}) {
	const {status, unavailable} = useLockedStatus();
	const [afterwards, setAfterwards] = useState<Afterwards>('delete');
	const [copiesToo, setCopiesToo] = useState(false);
	const [credential, setCredential] = useState('');
	const [error, setError] = useState('');
	const [retryAfterMs, setRetryAfterMs] = useState<number | undefined>();
	const [busy, setBusy] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);
	const copiesId = useId();
	const count = lockedMoveCount(request);
	const needsCredential = status?.configured === true && !status.unlocked;
	const ready = status?.configured === true;
	const keeping = request.kind === 'session' && afterwards === 'keep';
	const wait = useCooldown(
		retryAfterMs ?? (needsCredential ? status.retryAfterMs : undefined),
	);
	useEffect(() => {
		if (needsCredential) {
			formRef.current?.querySelector<HTMLElement>('input')?.focus();
		}
	}, [needsCredential]);

	async function move(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !ready) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('LOCKED_MOVE_IN', {
			source: sourceOf(request, afterwards),
			...(needsCredential && {credential}),
			...(copiesToo && !keeping && {deleteCopies: true}),
		});
		setBusy(false);
		if (!result?.ok) {
			setError(failureText(result, 'Could not move to the locked area.'));
			setRetryAfterMs((result as ActionFailure | undefined)?.retryAfterMs);
			setCredential('');
			return;
		}

		setCredential('');
		showStatus(lockedMoveSummary(result, request, afterwards), false, {
			toast: true,
		});
		onDone();
	}

	if (unavailable) {
		return (
			<>
				<DialogBody>
					<Note>{unavailable}</Note>
				</DialogBody>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onCancel}>
						<X aria-hidden="true" />
						Close
					</Button>
				</DialogFooter>
			</>
		);
	}

	if (!status) {
		return (
			<DialogBody>
				<p className="sr-only" role="status">
					Loading the locked area
				</p>
			</DialogBody>
		);
	}

	if (!status.configured) {
		return (
			<>
				<DialogBody>
					<Note>
						The locked area is not set up yet. Set it up first, with a PIN or
						password, then move this again.
					</Note>
				</DialogBody>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onCancel}>
						<X aria-hidden="true" />
						Cancel
					</Button>
					<Button type="button" onClick={onSetup}>
						<Lock aria-hidden="true" />
						Set up the locked area
					</Button>
				</DialogFooter>
			</>
		);
	}

	const links = plural(count, request.kind === 'session' ? 'link' : 'bookmark');
	return (
		<form ref={formRef} onSubmit={(event) => void move(event)}>
			<DialogBody>
				{request.kind === 'session' && (
					<RadioCardGroup
						label="The session"
						value={afterwards}
						onValueChange={(value) => setAfterwards(value as Afterwards)}
					>
						<RadioCard
							value="delete"
							icon={Lock}
							title="Delete it after moving"
							description="Its links leave the session. An emptied session is deleted, with no trash bin copy."
						/>
						<RadioCard
							value="keep"
							icon={LockOpen}
							title="Keep it"
							description="Only copies the links. They stay readable in the session."
						/>
					</RadioCardGroup>
				)}
				<MoveExplanation request={request} keeping={keeping} links={links} />
				{!keeping && (
					<div className="flex items-start gap-2">
						<Checkbox
							id={copiesId}
							className="mt-0.5"
							checked={copiesToo}
							onCheckedChange={(checked) => setCopiesToo(checked === true)}
						/>
						<Label htmlFor={copiesId} className="text-sm leading-5">
							Also delete {PROJECT.name}’s backups and recovery snapshots
							<span className="block text-xs font-normal text-muted-foreground">
								Removes the automatic and safety backups and the snapshots kept
								in the browser. Backup files in your Downloads folder stay. New
								backups start from your next change.
							</span>
						</Label>
					</div>
				)}
				{needsCredential ? (
					<>
						<PasscodeEntry
							value={credential}
							kind={status.kind}
							error={error}
							disabled={busy || wait > 0}
							onChange={setCredential}
						/>
						{wait > 0 && (
							<p className="text-xs text-muted-foreground" role="status">
								Too many wrong entries. Try again in {wait}{' '}
								{wait === 1 ? 'second' : 'seconds'}.
							</p>
						)}
					</>
				) : (
					error && <ErrorLine>{error}</ErrorLine>
				)}
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onCancel}>
					<X aria-hidden="true" />
					Cancel
				</Button>
				<Button
					type="submit"
					disabled={
						busy || wait > 0 || (needsCredential && credential.length === 0)
					}
				>
					{needsCredential ? (
						<LockOpen aria-hidden="true" />
					) : (
						<Lock aria-hidden="true" />
					)}
					{busy
						? 'Moving'
						: needsCredential
							? 'Unlock and move'
							: keeping
								? `Copy ${links}`
								: `Move ${links}`}
				</Button>
			</DialogFooter>
		</form>
	);
}

/**
The confirmation for moving bookmarks, a column, or a session's links into the locked area.
*/
export function LockedMoveDialog({
	request,
	showStatus,
	onOpenChange,
	onSetup,
	onMoved,
}: {
	request: LockedMoveRequest | null;
	showStatus: ShowStatus;
	onOpenChange: (open: boolean) => void;
	/**
	Opens the locked area dialog, where it is set up. The default opens the dashboard in a tab.
	*/
	onSetup?: () => void;
	/**
	Runs after a move, to reload what the page shows.
	*/
	onMoved: () => void;
}) {
	return (
		<Dialog open={request !== null} onOpenChange={onOpenChange}>
			<DialogContent size="sm">
				<DialogHeader>
					<DialogTitle>Move to locked area</DialogTitle>
					<DialogDescription>
						{request?.kind === 'column'
							? `Move the bookmarks of the “${request.name}” column into the encrypted locked area.`
							: request?.kind === 'session'
								? `Move the links of the session “${request.name}” into the encrypted locked area.`
								: `Move ${plural(request ? lockedMoveCount(request) : 0, 'selected bookmark')} into the encrypted locked area.`}
					</DialogDescription>
				</DialogHeader>
				{request && (
					<MoveForm
						request={request}
						showStatus={showStatus}
						onSetup={() => (onSetup ? onSetup() : void openLockedSetup())}
						onCancel={() => onOpenChange(false)}
						onDone={() => {
							onOpenChange(false);
							onMoved();
						}}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
