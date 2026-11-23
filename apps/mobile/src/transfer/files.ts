import * as DocumentPicker from 'expo-document-picker';
import {File, Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {MAX_IMPORT_BYTES} from '../../../extension/src/shared/import-formats';

export type PickedText = {name: string; text: string};

export class FileTooLargeError extends Error {}

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

function sharedFile(
	path: string,
	size: number | undefined,
	limit: number,
	verb: string,
): File {
	const file = new File(path);
	if ((size ?? file.size) > limit) {
		throw new FileTooLargeError(`That file is too large to ${verb}.`);
	}

	return file;
}

export async function readSharedText(
	path: string,
	size?: number,
): Promise<string> {
	return sharedFile(path, size, MAX_IMPORT_BYTES, 'import').text();
}

export async function readSharedBytes(
	path: string,
	size?: number,
): Promise<Uint8Array> {
	return sharedFile(path, size, MAX_BACKUP_BYTES, 'restore').bytes();
}

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

const MAX_BACKUP_BYTES = 60 * 1024 * 1024;

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
