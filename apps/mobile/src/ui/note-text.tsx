import {type StyleProp, Text, type TextStyle} from 'react-native';
import {
	notePieces,
	PASSAGE_LABEL,
} from '../../../extension/src/shared/note-links';
import {useColors} from './theme';

export function NoteText({
	notes,
	numberOfLines,
	style,
	onOpen,
}: {
	notes: string;
	numberOfLines: number;
	style: StyleProp<TextStyle>;
	onOpen?: (url: string) => void;
}) {
	const colors = useColors();
	return (
		<Text numberOfLines={numberOfLines} style={style}>
			{notePieces(notes).map((piece, index) =>
				piece.kind === 'text' ? (
					piece.text
				) : (
					<Text
						key={index}
						accessibilityRole="link"
						accessibilityLabel={piece.name}
						style={{color: colors.accent, fontWeight: '600'}}
						onPress={
							onOpen &&
							(() => {
								onOpen(piece.url);
							})
						}
					>
						{`↗ ${PASSAGE_LABEL}`}
					</Text>
				),
			)}
		</Text>
	);
}
