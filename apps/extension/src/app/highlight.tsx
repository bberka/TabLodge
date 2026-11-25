import {Fragment} from 'react';
import {highlightSegments} from '../shared/fuzzy';

export function Highlight({text, query}: {text: string; query: string}) {
	return (
		<>
			{highlightSegments(text, query).map((segment, index) =>
				segment.match ? (
					<mark
						key={index}
						className="rounded-xs bg-primary/20 px-0 text-inherit"
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
