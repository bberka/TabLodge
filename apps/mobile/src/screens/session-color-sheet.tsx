import {Text, View} from 'react-native';
import type {Session} from '../../../extension/src/shared/types';
import {BottomSheet} from '../bottom-sheet';
import {ColorPicker} from '../color-picker';
import {setSessionColor} from '../library';
import {edit} from '../library-store';
import {useColors} from '../theme';
import {Button} from '../ui';

/**
The drawer for giving a session a color. A choice is saved as soon as it is made, so Done only closes it.
*/
export function SessionColorSheet({
	session,
	onClose,
}: {
	session: Session | undefined;
	onClose: () => void;
}) {
	const colors = useColors();
	return (
		<BottomSheet
			visible={session !== undefined}
			label="Session color"
			onClose={onClose}
		>
			{session && (
				<View style={{gap: 12, paddingHorizontal: 20, paddingBottom: 8}}>
					<Text
						accessibilityRole="header"
						style={{color: colors.text, fontSize: 20, fontWeight: '700'}}
					>
						Color for {session.name}
					</Text>
					<ColorPicker
						selected={session.color ?? ''}
						onSelect={(color) => {
							void edit((current) =>
								setSessionColor(current, session.id, color, Date.now()),
							);
						}}
					/>
					<Button label="Done" icon="checkmark" onPress={onClose} />
				</View>
			)}
		</BottomSheet>
	);
}
