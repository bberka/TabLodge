import {ArrowUpRight} from 'lucide-react';
import {notePieces, PASSAGE_LABEL} from '../shared/note-links';

/**
A bookmark or saved tab note. A saved quote's passage link shows as a short "Go to passage" link; a plain click hands
its address to `onOpen`, and a modified click keeps the browser's own behavior (new tab, new window).
*/
export function NoteText({
	notes,
	className,
	onOpen,
}: {
	notes: string;
	className: string;
	onOpen: (url: string) => void;
}) {
	return (
		<p className={className}>
			{notePieces(notes).map((piece, index) =>
				piece.kind === 'text' ? (
					piece.text
				) : (
					<a
						key={index}
						href={piece.url}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={piece.name}
						className="rounded-xs font-medium not-italic text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
						onClick={(event) => {
							if (
								event.button !== 0 ||
								event.ctrlKey ||
								event.metaKey ||
								event.shiftKey
							) {
								return;
							}

							event.preventDefault();
							onOpen(piece.url);
						}}
					>
						<ArrowUpRight
							className="inline size-3.5 align-[-3px]"
							aria-hidden="true"
						/>
						{PASSAGE_LABEL}
					</a>
				),
			)}
		</p>
	);
}
