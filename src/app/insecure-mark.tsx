import {LockOpen} from 'lucide-react';
import {IconTooltip} from '../shared/ui';
import {showsInsecureMark} from './url-display';

const REASON =
	'Not secure: this page uses http, so what you send or see on it can be read or changed by others on the network. Your browser will also mark it Not secure.';

/**
A small amber open lock before an http address, with an explanation on hover or keyboard focus.
*/
export function InsecureMark({className = ''}: {className?: string}) {
	return (
		<IconTooltip
			label={
				<span className="block max-w-[24rem] whitespace-normal">{REASON}</span>
			}
		>
			<span
				role="img"
				// Focusable so keyboard users can read the explanation; it sits inside links, so it cannot be a button.
				// eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
				tabIndex={0}
				aria-label={REASON}
				className={`inline-block rounded-sm text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400 ${className}`}
			>
				<LockOpen className="h-3 w-3" aria-hidden="true" />
			</span>
		</IconTooltip>
	);
}

/**
The marker for `url` when the settings call for one, else nothing.
*/
export function InsecureMarkFor({
	url,
	settings,
	className = 'mr-1 align-[-1px]',
}: {
	url: string;
	settings: {markInsecureLinks?: boolean; markLocalLinks?: boolean};
	className?: string;
}) {
	return showsInsecureMark(url, settings) ? (
		<InsecureMark className={className} />
	) : null;
}
