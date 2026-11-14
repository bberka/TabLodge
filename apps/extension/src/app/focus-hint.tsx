import {useState} from 'react';
import {PanelLeft} from 'lucide-react';
import {Button} from '../shared/ui';
import {plural} from './plural';
import {FOCUS_HINT_KEY} from './focus-hint-rule';

// Remembered per browser profile, not synced: another device may have a different screen.
export function readFocusHintDismissed() {
	try {
		return localStorage.getItem(FOCUS_HINT_KEY) === '1';
	} catch {
		return false;
	}
}

function rememberFocusHintDismissed() {
	try {
		localStorage.setItem(FOCUS_HINT_KEY, '1');
	} catch {
		// Without storage the hint can come back on the next visit.
	}
}

/**
"You have N columns. Focus view shows one at a time." shown above a crowded Board.
*/
export function FocusViewHint({
	columnCount,
	onSwitch,
}: {
	columnCount: number;
	onSwitch: () => void;
}) {
	const [dismissed, setDismissed] = useState(readFocusHintDismissed);
	if (dismissed) {
		return null;
	}

	function dismiss() {
		rememberFocusHintDismissed();
		setDismissed(true);
	}

	return (
		<section
			aria-label="Focus view suggestion"
			className="mb-3 flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/6 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
		>
			<p className="min-w-0 text-sm">
				<span className="font-semibold">
					You have {plural(columnCount, 'column')}.
				</span>{' '}
				<span className="text-muted-foreground">
					Focus view lists them on the left and shows one at a time, which is
					easier to move around.
				</span>
			</p>
			<div className="flex shrink-0 flex-wrap gap-2">
				<Button
					size="sm"
					onClick={() => {
						dismiss();
						onSwitch();
					}}
				>
					<PanelLeft className="h-4 w-4" />
					Switch to Focus view
				</Button>
				<Button size="sm" variant="ghost" onClick={dismiss}>
					Not now
				</Button>
			</div>
		</section>
	);
}
