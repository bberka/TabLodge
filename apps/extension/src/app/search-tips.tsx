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
A key or key combination, and what it does.
*/
export type KeyTip = {keys: readonly string[]; meaning: string};

/**
A help button for a search field that lists the search operators, and the keys when given, in a popover. Nothing
shows until it is pressed.
*/
const NO_KEYS: readonly KeyTip[] = [];

export function SearchTipsButton({keys = NO_KEYS}: {keys?: readonly KeyTip[]}) {
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
				{keys.length > 0 && (
					<>
						<p className="mb-2 mt-3 text-xs font-semibold">Keys</p>
						<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
							{keys.map((tip) => (
								<div key={tip.meaning} className="contents">
									<dt className="flex gap-1">
										{tip.keys.map((key) => (
											<kbd
												key={key}
												className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground"
											>
												{key}
											</kbd>
										))}
									</dt>
									<dd className="text-muted-foreground">{tip.meaning}</dd>
								</div>
							))}
						</dl>
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}
