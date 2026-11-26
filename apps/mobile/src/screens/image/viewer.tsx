import {useSyncExternalStore} from 'react';
import {
	Image,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
	IMAGE_EXTENSIONS,
	imageUsageText,
} from '../../../../extension/src/shared/image-store';
import {useImageThumbs} from '../../library/image-thumbs';
import {deleteImageWithUndo} from '../../library/saved-images';
import {openLink} from '../../platform/open-links';
import {useColors} from '../../ui/theme';
import {Button, Empty, IconButton} from '../../ui/widgets';

let openUrl: string | undefined;
const listeners = new Set<() => void>();

const setOpen = (url: string | undefined) => {
	openUrl = url;
	for (const listener of listeners) {
		listener();
	}
};

export function openImageViewer(url: string): void {
	setOpen(url);
}

const savedDate = (time: number) =>
	new Date(time).toLocaleString(undefined, {
		dateStyle: 'long',
		timeStyle: 'short',
	});

function Viewer({url, onClose}: {url: string; onClose: () => void}) {
	const colors = useColors();
	const image = useImageThumbs().get(url);
	const remove = () => {
		void deleteImageWithUndo(url, openImageViewer).then(onClose);
	};

	return (
		<SafeAreaView style={[styles.screen, {backgroundColor: colors.background}]}>
			<View style={styles.bar}>
				<IconButton icon="arrow-back" label="Close image" onPress={onClose} />
				<View style={styles.barActions}>
					<Button
						kind="plain"
						icon="open-outline"
						label="Open address"
						onPress={() => {
							openLink(url);
						}}
					/>
					{image && (
						<IconButton
							icon="trash-outline"
							label="Delete image on every device"
							color={colors.danger}
							onPress={remove}
						/>
					)}
				</View>
			</View>
			{image ? (
				<ScrollView contentContainerStyle={styles.scroll}>
					<View
						style={[
							styles.frame,
							{backgroundColor: colors.surface, borderColor: colors.border},
						]}
					>
						<Image
							accessibilityLabel={`Thumbnail of the image saved from ${new URL(image.url).hostname}`}
							source={{uri: image.uri}}
							resizeMode="contain"
							style={[
								styles.picture,
								{aspectRatio: image.width / image.height},
							]}
						/>
					</View>
					<Text style={[styles.note, {color: colors.text}]}>
						{image.device
							? `This is the thumbnail. The full image is kept on ${image.device}.`
							: 'This is the thumbnail. The full image is kept on the device that saved it.'}
					</Text>
					<View style={styles.meta}>
						<Text style={{color: colors.muted}}>
							{IMAGE_EXTENSIONS[image.type].toUpperCase()}, {image.width} ×{' '}
							{image.height} pixels,{' '}
							{imageUsageText(image.size).split(' of ', 1)[0]}
						</Text>
						<Text style={{color: colors.muted}}>
							Saved {savedDate(image.savedAt)}
						</Text>
						<Pressable
							accessibilityRole="link"
							accessibilityHint="Opens the image's address"
							onPress={() => {
								openLink(image.url);
							}}
						>
							<Text style={[styles.link, {color: colors.accent}]}>
								{image.url}
							</Text>
						</Pressable>
					</View>
				</ScrollView>
			) : (
				<Empty icon="image-outline" title="No image here">
					This phone has no saved image for this address.
				</Empty>
			)}
		</SafeAreaView>
	);
}

export function ImageViewerHost() {
	const url = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => openUrl,
	);
	const close = () => {
		setOpen(undefined);
	};

	return (
		<Modal
			statusBarTranslucent
			visible={url !== undefined}
			animationType="slide"
			onRequestClose={close}
		>
			{url !== undefined && <Viewer url={url} onClose={close} />}
		</Modal>
	);
}

const styles = StyleSheet.create({
	screen: {flex: 1},
	bar: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 8,
	},
	barActions: {flexDirection: 'row', alignItems: 'center', gap: 4},
	scroll: {padding: 16, gap: 16},
	frame: {borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 8},
	picture: {width: '100%'},
	note: {fontSize: 16, lineHeight: 22},
	meta: {gap: 6},
	link: {textDecorationLine: 'underline'},
});
