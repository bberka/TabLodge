import {CircleHelp} from 'lucide-react';
import {SEARCH_TIPS} from '../shared/search-query';
import {
	Button,
	IconTooltip,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '../shared/ui';

/**
A help button for a search field that lists the search operators in a popover. Nothing shows until it is pressed.
*/
export function SearchTipsButton() {
	return (
		<Popover>
			<IconTooltip label="Search tips">
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 shrink-0 text-muted-foreground"
						aria-label="Search tips"
					>
						<CircleHelp className="h-4 w-4" aria-hidden="true" />
					</Button>
				</PopoverTrigger>
			</IconTooltip>
			<PopoverContent
				align="end"
				aria-label="Search tips"
				className="w-auto p-3"
				// Escape closes the tips only, not the palette around them.
				onEscapeKeyDown={(event) => {
					event.stopPropagation();
				}}
			>
				<p className="mb-2 text-xs font-semibold">Search tips</p>
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
					{SEARCH_TIPS.map((tip) => (
						<div key={tip.example} className="contents">
							<dt>
								<code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-foreground">
									{tip.example}
								</code>
							</dt>
							<dd className="text-muted-foreground">{tip.meaning}</dd>
						</div>
					))}
				</dl>
			</PopoverContent>
		</Popover>
	);
}
