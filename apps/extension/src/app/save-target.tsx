import {Bookmark, PanelsTopLeft, Plus} from 'lucide-react';
import {SAVE_TARGET_CHOICES} from '../shared/choice-copy';
import {
	Label,
	RadioChoiceGroup,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../shared/ui';

export type SaveTarget = 'bookmark' | 'session';

type SessionOption = {id: string; name: string};

export const NEW_SESSION = '__new-session__';

const ICONS = {bookmark: Bookmark, session: PanelsTopLeft} as const;

const CHOICES = SAVE_TARGET_CHOICES.map((choice) => ({
	...choice,
	icon: ICONS[choice.value],
}));

export function SaveTargetChoice({
	target,
	onTargetChange,
	sessions,
	allowNewSession = false,
}: {
	target: SaveTarget;
	onTargetChange: (target: SaveTarget) => void;
	sessions: readonly SessionOption[];
	allowNewSession?: boolean;
}) {
	if (sessions.length === 0 && !allowNewSession) {
		return null;
	}

	return (
		<RadioChoiceGroup
			label="Save to"
			value={target}
			choices={CHOICES}
			onValueChange={onTargetChange}
		/>
	);
}

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
