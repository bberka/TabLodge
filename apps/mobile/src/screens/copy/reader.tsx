/*
The reader for a kept copy, over the whole app. Blocks are text, drawn as Text, so nothing from the page can run.
*/
import {useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import {
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import type {
	CopyBlock,
	PageCopy,
} from '../../../../extension/src/shared/page-copy';
import {deleteCopyWithUndo} from '../../library/copy-undo';
import {readCopy} from '../../library/page-copies';
import {openLink} from '../../platform/open-links';
import {useColors, type Colors} from '../../ui/theme';
import {Button, Empty, IconButton} from '../../ui/widgets';

let openUrl: string | undefined;
const listeners = new Set<() => void>();

const setOpen = (url: string | undefined) => {
	openUrl = url;
	for (const listener of listeners) {
		listener();
	}
};

export function openReader(url: string): void {
	setOpen(url);
}

const keptDate = (time: number) =>
	new Date(time).toLocaleString(undefined, {
		dateStyle: 'long',
		timeStyle: 'short',
	});

function Block({block, colors}: {block: CopyBlock; colors: Colors}) {
	switch (block.type) {
		case 'heading': {
			return (
				<Text
					accessibilityRole="header"
					style={[styles.heading, {color: colors.text}]}
				>
					{block.text}
				</Text>
			);
		}

		case 'item': {
			return (
				<View style={styles.item}>
					<Text style={[styles.body, {color: colors.text}]}>•</Text>
					<Text style={[styles.body, styles.itemText, {color: colors.text}]}>
						{block.text}
					</Text>
				</View>
			);
		}

		case 'quote': {
			return (
				<Text
					style={[
						styles.body,
						styles.quote,
						{color: colors.muted, borderColor: colors.accent},
					]}
				>
					{block.text}
				</Text>
			);
		}

		case 'code': {
			return (
				<ScrollView
					horizontal
					style={[styles.code, {backgroundColor: colors.pressed}]}
				>
					<Text style={[styles.codeText, {color: colors.text}]}>
						{block.text}
					</Text>
				</ScrollView>
			);
		}

		default: {
			return (
				<Text style={[styles.body, {color: colors.text}]}>{block.text}</Text>
			);
		}
	}
}

function Reader({url, onClose}: {url: string; onClose: () => void}) {
	const colors = useColors();
	const [copy, setCopy] = useState<PageCopy | null>();
	useEffect(() => {
		let live = true;
		void readCopy(url).then((found) => {
			if (live) {
				setCopy(found ?? null);
			}
		});
		return () => {
			live = false;
		};
	}, [url]);

	const remove = () => {
		void deleteCopyWithUndo(url, openReader).then(onClose);
	};

	let body: ReactNode = null;
	if (copy === null) {
		body = (
			<Empty icon="document-text-outline" title="No copy here">
				This phone has no copy of this page.
			</Empty>
		);
	} else if (copy) {
		body = (
			<ScrollView contentContainerStyle={styles.scroll}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					{copy.title}
				</Text>
				<View style={styles.meta}>
					{copy.byline && (
						<Text style={{color: colors.muted}}>By {copy.byline}</Text>
					)}
					<Text style={{color: colors.muted}}>
						Kept {keptDate(copy.savedAt)}
					</Text>
					<Pressable
						accessibilityRole="link"
						accessibilityHint="Opens the original page"
						onPress={() => {
							openLink(copy.url);
						}}
					>
						<Text style={[styles.link, {color: colors.accent}]}>
							{copy.url}
						</Text>
					</Pressable>
				</View>
				<View style={[styles.rule, {backgroundColor: colors.border}]} />
				{copy.blocks.map((block, index) => (
					// A kept copy never changes, so its position is a stable key.
					<Block key={index} block={block} colors={colors} />
				))}
			</ScrollView>
		);
	}

	return (
		<SafeAreaView style={[styles.screen, {backgroundColor: colors.background}]}>
			<View style={styles.bar}>
				<IconButton icon="arrow-back" label="Close copy" onPress={onClose} />
				<View style={styles.barActions}>
					<Button
						kind="plain"
						icon="open-outline"
						label="Original"
						onPress={() => {
							openLink(url);
						}}
					/>
					{copy && (
						<IconButton
							icon="trash-outline"
							label="Delete copy"
							color={colors.danger}
							onPress={remove}
						/>
					)}
				</View>
			</View>
			{body}
		</SafeAreaView>
	);
}

/**
Draws the reader `openReader` asks for. Mount it once, near the root.
*/
export function ReaderHost() {
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
			{url !== undefined && <Reader url={url} onClose={close} />}
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
		paddingVertical: 4,
	},
	barActions: {flexDirection: 'row', alignItems: 'center', gap: 4},
	scroll: {paddingHorizontal: 20, paddingBottom: 48, gap: 14},
	title: {fontSize: 26, fontWeight: '700', lineHeight: 32},
	meta: {gap: 4},
	link: {textDecorationLine: 'underline'},
	rule: {height: StyleSheet.hairlineWidth, marginVertical: 4},
	heading: {fontSize: 20, fontWeight: '700', lineHeight: 26, marginTop: 8},
	body: {fontSize: 16, lineHeight: 25},
	item: {flexDirection: 'row', gap: 8, paddingStart: 4},
	itemText: {flex: 1},
	quote: {borderStartWidth: 3, paddingStart: 12},
	code: {borderRadius: 8, padding: 12},
	codeText: {fontFamily: 'monospace', fontSize: 14, lineHeight: 20},
});
