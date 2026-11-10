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
Where a new link goes: a bookmark column or an existing session. Pass `children` for the column field, which the
caller owns because each dialog already has one. Renders only the column field when there are no sessions to choose.
*/
export function SaveTargetFields({
	idPrefix,
	target,
	onTargetChange,
	sessions,
	sessionId,
	onSessionChange,
	children,
}: {
	idPrefix: string;
	target: SaveTarget;
	onTargetChange: (target: SaveTarget) => void;
	sessions: readonly SessionOption[];
	sessionId: string;
	onSessionChange: (id: string) => void;
	children: React.ReactNode;
}) {
	if (sessions.length === 0) {
		return children;
	}

	return (
		<>
			<SegmentedControl
				fullWidth
				label="Save to"
				value={target}
				options={[
					{value: 'bookmark', label: 'Bookmark column'},
					{value: 'session', label: 'Session'},
				]}
				onValueChange={onTargetChange}
			/>
			{target === 'session' ? (
				<div className="space-y-1.5">
					<Label htmlFor={`${idPrefix}-session`}>Session</Label>
					<Select value={sessionId} onValueChange={onSessionChange}>
						<SelectTrigger id={`${idPrefix}-session`}>
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
			) : (
				children
			)}
		</>
	);
}
