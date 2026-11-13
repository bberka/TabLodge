import {Bookmark, PanelsTopLeft, Plus} from 'lucide-react';
import {
	Label,
	SegmentedControl,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../shared/ui';

export type SaveTarget = 'bookmark' | 'session';

type SessionOption = {id: string; name: string};

/**
The session picker's value for "create a new session", like the new column choice in the column picker.
*/
export const NEW_SESSION = '__new-session__';

const OPTIONS = [
	{
		value: 'bookmark',
		label: (
			<span className="inline-flex items-center gap-2">
				<Bookmark className="h-4 w-4" aria-hidden="true" />
				Bookmark column
			</span>
		),
	},
	{
		value: 'session',
		label: (
			<span className="inline-flex items-center gap-2">
				<PanelsTopLeft className="h-4 w-4" aria-hidden="true" />
				Session
			</span>
		),
	},
] as const;

/**
The "Save to" switch between a bookmark column and an existing session. Renders nothing when there is no session to
choose, so the dialog keeps its plain column field.
*/
export function SaveTargetChoice({
	target,
	onTargetChange,
	sessions,
	allowNewSession = false,
}: {
	target: SaveTarget;
	onTargetChange: (target: SaveTarget) => void;
	sessions: readonly SessionOption[];
	/**
	Offer the Session choice even with no saved session, since the picker can create one.
	*/
	allowNewSession?: boolean;
}) {
	if (sessions.length === 0 && !allowNewSession) {
		return null;
	}

	return (
		<SegmentedControl
			fullWidth
			label="Save to"
			value={target}
			options={OPTIONS}
			onValueChange={onTargetChange}
		/>
	);
}

/**
The session picker shown in place of the column field while the target is a session.
*/
export function SaveTargetSessionField({
	id,
	sessions,
	value,
	onValueChange,
	allowNewSession = false,
}: {
	id: string;
	sessions: readonly SessionOption[];
	value: string;
	onValueChange: (id: string) => void;
	allowNewSession?: boolean;
}) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>Session</Label>
			<Select value={value} onValueChange={onValueChange}>
				<SelectTrigger id={id}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{sessions.map((session) => (
						<SelectItem key={session.id} value={session.id}>
							{session.name}
						</SelectItem>
					))}
					{allowNewSession && (
						<SelectItem value={NEW_SESSION}>
							<span className="inline-flex items-center gap-2">
								<Plus className="h-4 w-4" aria-hidden="true" />
								New session
							</span>
						</SelectItem>
					)}
				</SelectContent>
			</Select>
		</div>
	);
}
