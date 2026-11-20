import {StyleSheet, View} from 'react-native';
import {
	isMediaKind,
	LINK_KIND_LABELS,
	linkKind,
	type MediaKind,
} from '../../../extension/src/shared/link-kind';
import {hostOf} from '../library/store-shape';
import {SiteIcon} from './site-icon';
import {useColors} from './theme';
import {Icon, type IconName} from './widgets';

const KIND_ICONS: Record<MediaKind, IconName> = {
	image: 'image',
	pdf: 'document-text',
	video: 'film',
};

/**
The media kind in words at the start of a row's accessibility label ("Image, "), or nothing for other links, whose
kind a bookmark row says with its tags.
*/
export function spokenKind(url: string) {
	const kind = linkKind(url);
	return isMediaKind(kind) ? `${LINK_KIND_LABELS[kind]}, ` : '';
}

/**
A bookmark's site icon, with a small mark on its corner when the link is an image, a PDF, or a video. The kind is
read from the address each time (see link-kind.ts); the row's accessibility label says it with spokenKind.
*/
export function BookmarkIcon({url, size}: {url: string; size: number}) {
	const colors = useColors();
	const kind = linkKind(url);
	const icon = <SiteIcon host={hostOf(url)} size={size} />;
	if (!isMediaKind(kind)) {
		return icon;
	}

	const badge = Math.round(size * 0.45);
	return (
		<View>
			{icon}
			<View
				style={[
					styles.badge,
					{
						width: badge,
						height: badge,
						borderRadius: badge / 2,
						backgroundColor: colors.surface,
						borderColor: colors.border,
					},
				]}
			>
				<Icon name={KIND_ICONS[kind]} size={badge * 0.62} color={colors.text} />
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	badge: {
		position: 'absolute',
		right: -3,
		bottom: -3,
		alignItems: 'center',
		justifyContent: 'center',
		borderWidth: StyleSheet.hairlineWidth,
	},
});
