import {Fragment} from 'react';
import {highlightSegments} from './fuzzy';

// A subtle <mark> around the parts of `text` that match the search query; the text itself never changes, so nothing shifts.
export function Highlight({text, query}: {text: string; query: string}) {
	return (
		<>
			{highlightSegments(text, query).map((segment, index) =>
				segment.match ? (
					<mark
						key={index}
						className="rounded-sm bg-primary/20 px-0 text-inherit"
					>
						{segment.text}
					</mark>
				) : (
					<Fragment key={index}>{segment.text}</Fragment>
				),
			)}
		</>
	);
}
