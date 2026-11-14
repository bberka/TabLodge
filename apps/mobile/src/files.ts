import * as DocumentPicker from 'expo-document-picker';
import {File, Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {MAX_IMPORT_BYTES} from '../../extension/src/shared/import-formats';

export type PickedText = {name: string; text: string};

export class FileTooLargeError extends Error {}

/**
Lets the person pick a file and reads it as text. Nothing is returned when they back out. A file larger than the
extension's own import limit is refused.
*/
export async function pickTextFile(): Promise<PickedText | undefined> {
	const result = await DocumentPicker.getDocumentAsync({
		type: '*/*',
		copyToCacheDirectory: true,
		multiple: false,
	});
	const asset = result.canceled ? undefined : result.assets[0];
	if (!asset) {
		return undefined;
	}

	if ((asset.size ?? 0) > MAX_IMPORT_BYTES) {
		throw new FileTooLargeError('That file is too large to import.');
	}

	return {name: asset.name, text: await new File(asset.uri).text()};
}

/**
Hands a file to Android's share sheet, which can save it to Files or Drive or send it to another app. It is written to
the cache first, which the system clears when it needs room.
*/
export async function shareTextFile(
	filename: string,
	mime: string,
	content: string,
): Promise<void> {
	const file = new File(Paths.cache, filename);
	if (file.exists) {
		file.delete();
	}

	file.create();
	await file.write(content);
	await Sharing.shareAsync(file.uri, {
		mimeType: mime.split(';', 1)[0],
		dialogTitle: filename,
	});
}

/**
Hands a binary file, such as a backup ZIP, to Android's share sheet, the same way as `shareTextFile`.
*/
export async function shareBinaryFile(
	filename: string,
	mime: string,
	bytes: Uint8Array,
): Promise<void> {
	const file = new File(Paths.cache, filename);
	if (file.exists) {
		file.delete();
	}

	file.create();
	await file.write(bytes);
	await Sharing.shareAsync(file.uri, {mimeType: mime, dialogTitle: filename});
}

export type PickedBytes = {name: string; bytes: Uint8Array};

// A full backup holds the whole library; the extension reads up to this much of one too.
const MAX_BACKUP_BYTES = 60 * 1024 * 1024;

/**
Lets the person pick a file and reads it as bytes, for a backup ZIP. Nothing is returned when they back out.
*/
export async function pickBinaryFile(): Promise<PickedBytes | undefined> {
	const result = await DocumentPicker.getDocumentAsync({
		type: '*/*',
		copyToCacheDirectory: true,
		multiple: false,
	});
	const asset = result.canceled ? undefined : result.assets[0];
	if (!asset) {
		return undefined;
	}

	if ((asset.size ?? 0) > MAX_BACKUP_BYTES) {
		throw new FileTooLargeError('That file is too large to restore.');
	}

	return {name: asset.name, bytes: await new File(asset.uri).bytes()};
}
