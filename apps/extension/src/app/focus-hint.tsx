import {useState} from 'react';
import {PanelLeft} from 'lucide-react';
import {Button} from '../shared/ui';
import {plural} from './plural';
import {FOCUS_HINT_KEY} from './focus-hint-rule';
import {cn} from '@/lib/utils';

export function readFocusHintDismissed(key = FOCUS_HINT_KEY) {
	try {
		return localStorage.getItem(key) === '1';
	} catch {
		return false;
	}
}

function rememberFocusHintDismissed(key: string) {
	try {
		localStorage.setItem(key, '1');
	} catch {}
}

export function FocusViewHint({
	count,
	noun = 'column',
	label = 'Focus view suggestion',
	text = 'Focus view lists them on the left and shows one at a time, which is easier to move around.',
	action = 'Switch to Focus view',
	storageKey = FOCUS_HINT_KEY,
	className,
	onSwitch,
}: {
	count: number;
	noun?: string;
	label?: string;
	text?: string;
	action?: string;
	storageKey?: string;
	className?: string;
	onSwitch: () => void;
}) {
	const [dismissed, setDismissed] = useState(() =>
		readFocusHintDismissed(storageKey),
	);
	if (dismissed) {
		return null;
	}

	function dismiss() {
		rememberFocusHintDismissed(storageKey);
		setDismissed(true);
	}

	return (
		<section
			aria-label={label}
			className={cn(
				'mb-3 flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/6 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
				className,
			)}
		>
			<p className="min-w-0 text-sm">
				<span className="font-semibold">You have {plural(count, noun)}.</span>{' '}
				<span className="text-muted-foreground">{text}</span>
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
					{action}
				</Button>
				<Button size="sm" variant="ghost" onClick={dismiss}>
					Not now
				</Button>
			</div>
		</section>
	);
}
