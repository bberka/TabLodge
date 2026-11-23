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

export function spokenKind(url: string) {
	const kind = linkKind(url);
	return isMediaKind(kind) ? `${LINK_KIND_LABELS[kind]}, ` : '';
}

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
