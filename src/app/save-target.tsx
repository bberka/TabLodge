import {Bookmark, PanelsTopLeft} from 'lucide-react';
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
}: {
	target: SaveTarget;
	onTargetChange: (target: SaveTarget) => void;
	sessions: readonly SessionOption[];
}) {
	if (sessions.length === 0) {
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
}: {
	id: string;
	sessions: readonly SessionOption[];
	value: string;
	onValueChange: (id: string) => void;
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
				</SelectContent>
			</Select>
		</div>
	);
}
