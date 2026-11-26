import {cleanText, normalizeUrl} from './library-normalize';
import {hashText, isRecord} from './library-values';
import {fromBase64, toBase64} from './private-lock';

export const IMAGE_TYPES = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/avif',
] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const IMAGE_EXTENSIONS: Readonly<Record<ImageType, string>> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/avif': 'avif',
};

export const IMAGE_INDEX_KEY = 'tablodge.images';
export const IMAGE_KEY_PREFIX = 'tablodge.image.';
export const THUMB_KEY_PREFIX = 'tablodge.thumb.';
export const IMAGE_MAX_BYTES = 10_000_000;
export const IMAGE_BUDGET = 100_000_000;
export const THUMB_MAX_BYTES = 10_000;
export const THUMB_MAX_SIDE = 256;
export const IMAGE_DELETED = 'Image deleted. The bookmark stays saved.';
const SIDE_MAX = 65_535;
const DEVICE_MAX = 80;
const SNIFF_CHARS = 128;

export type ImageMeta = {
	url: string;
	type: ImageType;
	width: number;
	height: number;
	size: number;
	savedAt: number;
	device: string;
};

export type ImageEntry = ImageMeta & {id: string; held: number};
export type SavedThumb = ImageMeta & {thumb: string};
export type SavedImage = SavedThumb & {data: string};
export type SyncedThumb = {id: string; value: SavedThumb};

export type ImageStorage = {
	get(keys: string[]): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
	remove(keys: string[]): Promise<void>;
};

export type ImageFailure = 'unsupported' | 'too-large' | 'full';
export type ImageKeepResult =
	| {ok: true; entry: ImageEntry}
	| {ok: false; reason: ImageFailure; error: string};

const megabytes = (size: number) =>
	`${Math.max(1, Math.round(size / 1_000_000))} MB`;

export const IMAGE_ERRORS: Record<ImageFailure, string> = {
	unsupported:
		'This is not a picture TabLodge can keep. It keeps JPEG, PNG, GIF, WebP and AVIF images.',
	'too-large': `This image is too large to keep. An image can be up to ${megabytes(IMAGE_MAX_BYTES)}.`,
	full: `Images are full. This device keeps up to ${megabytes(IMAGE_BUDGET)} of images; delete images you no longer need, then try again.`,
};

const BASE64 = /^[\d+/a-z]*={0,2}$/i;
export function base64Size(text: string): number {
	if (text.length % 4 !== 0) {
		return -1;
	}

	const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
	return (text.length / 4) * 3 - padding;
}

export const base64ToBytes = (text: string): Uint8Array => fromBase64(text);
export const bytesToBase64 = (bytes: Uint8Array): string => toBase64(bytes);

const startsWith = (bytes: Uint8Array, magic: readonly number[], at = 0) =>
	magic.every((byte, index) => bytes[at + index] === byte);
const ascii = (text: string) => [...text].map((char) => char.codePointAt(0)!);
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF = [ascii('GIF87a'), ascii('GIF89a')];
const RIFF = ascii('RIFF');
const WEBP = ascii('WEBP');
const FTYP = ascii('ftyp');
const AVIF = [ascii('avif'), ascii('avis')];

export function sniffImageType(bytes: Uint8Array): ImageType | undefined {
	if (startsWith(bytes, JPEG)) {
		return 'image/jpeg';
	}

	if (startsWith(bytes, PNG)) {
		return 'image/png';
	}

	if (GIF.some((magic) => startsWith(bytes, magic))) {
		return 'image/gif';
	}

	if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
		return 'image/webp';
	}

	if (!startsWith(bytes, FTYP, 4)) {
		return undefined;
	}

	const boxEnd = Math.min(
		bytes.length,
		bytes[0] * 16_777_216 + bytes[1] * 65_536 + bytes[2] * 256 + bytes[3],
	);
	for (let at = 8; at + 4 <= boxEnd; at += at === 8 ? 8 : 4) {
		if (AVIF.some((brand) => startsWith(bytes, brand, at))) {
			return 'image/avif';
		}
	}

	return undefined;
}

function encodedImage(
	value: unknown,
	maxBytes: number,
): 'too-large' | {type: ImageType; size: number} | undefined {
	if (typeof value !== 'string' || value === '') {
		return undefined;
	}

	const size = base64Size(value);
	if (size > maxBytes) {
		return 'too-large';
	}

	if (size <= 0 || !BASE64.test(value)) {
		return undefined;
	}

	const type = sniffImageType(base64ToBytes(value.slice(0, SNIFF_CHARS)));
	return type && {type, size};
}

const side = (value: unknown) => {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 && number <= SIDE_MAX
		? number
		: undefined;
};

export const imageId = (url: string) => hashText(url);

export const imageDataUrl = (type: ImageType, data: string) =>
	`data:${type};base64,${data}`;

export const thumbDataUrl = (thumb: string) =>
	imageDataUrl(
		sniffImageType(base64ToBytes(thumb.slice(0, SNIFF_CHARS))) ?? 'image/webp',
		thumb,
	);

function decoded(text: string) {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

export function imageFileName(image: Pick<ImageMeta, 'url' | 'type'>): string {
	const address = URL.canParse(image.url) ? new URL(image.url) : undefined;
	const host = address?.hostname.replace(/^www\./, '') ?? '';
	const name = decoded(address?.pathname.split('/').pop() ?? '');

	const stem = name
		.replace(/\.[\da-z]{1,5}$/i, '')
		.replaceAll(/[^\w\-.]+/g, '-')
		.replaceAll(/^-+|-+$/g, '')
		.slice(0, 60);
	return `${[host, stem].filter(Boolean).join('-') || 'image'}.${IMAGE_EXTENSIONS[image.type]}`;
}

function parseMeta(value: unknown): ImageMeta | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const url = normalizeUrl(value.url);
	const savedAt = Number(value.savedAt);
	const width = side(value.width);
	const height = side(value.height);
	const size = Number(value.size);
	const type = IMAGE_TYPES.find((known) => known === value.type);
	if (
		!url ||
		!type ||
		!width ||
		!height ||
		!Number.isFinite(savedAt) ||
		savedAt <= 0 ||
		!Number.isSafeInteger(size) ||
		size <= 0
	) {
		return undefined;
	}

	return {
		url,
		type,
		width,
		height,
		size,
		savedAt,
		device: cleanText(value.device, '', DEVICE_MAX),
	};
}

export function parseThumb(
	value: unknown,
): SavedThumb | 'too-large' | undefined {
	const meta = parseMeta(value);
	const thumb = meta
		? encodedImage((value as {thumb?: unknown}).thumb, THUMB_MAX_BYTES)
		: undefined;
	if (thumb === 'too-large') {
		return thumb;
	}

	return meta && thumb
		? {...meta, thumb: (value as {thumb: string}).thumb}
		: undefined;
}

export function parseSavedImage(
	value: unknown,
): SavedImage | 'too-large' | undefined {
	const data = isRecord(value)
		? encodedImage(value.data, IMAGE_MAX_BYTES)
		: undefined;
	if (!data || data === 'too-large') {
		return data;
	}

	const meta = parseThumb({
		...(value as Record<string, unknown>),
		type: data.type,
		size: data.size,
	});
	return !meta || meta === 'too-large'
		? meta
		: {...meta, data: (value as {data: string}).data};
}

function parseIndex(value: unknown): ImageEntry[] {
	const items =
		isRecord(value) && Array.isArray(value.items) ? value.items : [];
	const seen = new Set<string>();
	return (items as unknown[]).flatMap((item) => {
		const meta = parseMeta(item);
		const held = isRecord(item) ? Number(item.held) : -1;
		if (
			!meta ||
			seen.has(meta.url) ||
			!Number.isSafeInteger(held) ||
			held < 0
		) {
			return [];
		}

		seen.add(meta.url);
		return [{...meta, id: imageId(meta.url), held}];
	});
}

const imageKey = (id: string) => `${IMAGE_KEY_PREFIX}${id}`;
const thumbKey = (id: string) => `${THUMB_KEY_PREFIX}${id}`;

export type ImageStore = ReturnType<typeof createImageStore>;

export function createImageStore(
	storage: ImageStorage,
	budget: number = IMAGE_BUDGET,
) {
	let queue: Promise<unknown> = Promise.resolve();
	const serial = <T>(run: () => Promise<T>): Promise<T> => {
		const next = queue.then(run);
		queue = next.catch(() => undefined);
		return next;
	};

	const readIndex = async () =>
		parseIndex((await storage.get([IMAGE_INDEX_KEY]))[IMAGE_INDEX_KEY]);
	const indexValue = (items: ImageEntry[]) => ({
		[IMAGE_INDEX_KEY]: {
			v: 1,
			items: items.map(({id: _id, ...item}) => item),
		},
	});
	const writeIndex = (items: ImageEntry[]) => storage.set(indexValue(items));

	const drop = async (items: ImageEntry[], gone: readonly ImageEntry[]) => {
		if (gone.length === 0) {
			return 0;
		}

		const urls = new Set(gone.map((item) => item.url));
		await storage.remove(
			gone.flatMap((item) => [imageKey(item.id), thumbKey(item.id)]),
		);
		await writeIndex(items.filter((item) => !urls.has(item.url)));
		return gone.length;
	};

	const readThumb = async (entry: ImageEntry) => {
		const key = thumbKey(entry.id);
		const thumb = parseThumb((await storage.get([key]))[key]);
		return thumb && thumb !== 'too-large' && thumb.url === entry.url
			? thumb
			: undefined;
	};

	const place = async (
		items: ImageEntry[],
		value: unknown,
	): Promise<ImageKeepResult> => {
		const image = parseSavedImage(value);
		if (!image) {
			return {
				ok: false,
				reason: 'unsupported',
				error: IMAGE_ERRORS.unsupported,
			};
		}

		if (image === 'too-large') {
			return {ok: false, reason: 'too-large', error: IMAGE_ERRORS['too-large']};
		}

		const old = items.find((item) => item.url === image.url);
		const used = items.reduce((sum, item) => sum + item.held, 0);
		if (used - (old?.held ?? 0) + image.size > budget) {
			return {ok: false, reason: 'full', error: IMAGE_ERRORS.full};
		}

		const {data, thumb, ...meta} = image;
		const entry: ImageEntry = {
			...meta,
			id: imageId(image.url),
			held: image.size,
		};
		const next = [...items.filter((item) => item.url !== image.url), entry];
		await storage.set({
			[imageKey(entry.id)]: {v: 1, url: image.url, type: image.type, data},
			[thumbKey(entry.id)]: {v: 1, ...meta, thumb},
			...indexValue(next),
		});
		items.splice(0, items.length, ...next);
		return {ok: true, entry};
	};

	const readOriginal = async (entry: ImageEntry) => {
		if (entry.held === 0) {
			return undefined;
		}

		const key = imageKey(entry.id);
		const stored = (await storage.get([key]))[key];
		const thumb = await readThumb(entry);
		const image =
			thumb && isRecord(stored) && stored.url === entry.url
				? parseSavedImage({...thumb, data: stored.data})
				: undefined;
		return image && image !== 'too-large' ? image : undefined;
	};

	return {
		list: () => serial(readIndex),

		async usage() {
			const items = await serial(readIndex);
			return {
				count: items.length,
				held: items.filter((item) => item.held > 0).length,
				size: items.reduce((sum, item) => sum + item.held, 0),
				budget,
			};
		},

		keep: (image: unknown) =>
			serial(async () => place(await readIndex(), image)),

		read: (url: string) =>
			serial(async () => {
				const entry = (await readIndex()).find((item) => item.url === url);
				return entry && readOriginal(entry);
			}),

		thumbs: (urls?: readonly string[]) =>
			serial(async () => {
				const wanted = urls && new Set(urls);
				const items = (await readIndex()).filter(
					(item) => !wanted || wanted.has(item.url),
				);
				if (items.length === 0) {
					return [];
				}

				const stored = await storage.get(
					items.map((item) => thumbKey(item.id)),
				);
				return items.flatMap((item) => {
					const thumb = parseThumb(stored[thumbKey(item.id)]);
					return thumb && thumb !== 'too-large' && thumb.url === item.url
						? [{...thumb, held: item.held > 0}]
						: [];
				});
			}),

		remove: (url: string) =>
			serial(async () => {
				const items = await readIndex();
				return (
					(await drop(
						items,
						items.filter((item) => item.url === url),
					)) > 0
				);
			}),

		sweep: (liveUrls: ReadonlySet<string>) =>
			serial(async () => {
				const items = await readIndex();
				return drop(
					items,
					items.filter((item) => !liveUrls.has(item.url)),
				);
			}),

		synced: () =>
			serial(async () => {
				const items = await readIndex();
				if (items.length === 0) {
					return [];
				}

				const stored = await storage.get(
					items.map((item) => thumbKey(item.id)),
				);
				return items.flatMap((item): SyncedThumb[] => {
					const thumb = parseThumb(stored[thumbKey(item.id)]);
					return thumb && thumb !== 'too-large' && thumb.url === item.url
						? [{id: item.id, value: thumb}]
						: [];
				});
			}),

		applySynced: (put: readonly unknown[], remove: readonly string[]) =>
			serial(async () => {
				const items = await readIndex();
				const gone = new Set(remove);
				const writes: Record<string, unknown> = {};
				for (const value of put) {
					const thumb = parseThumb(value);
					if (!thumb || thumb === 'too-large') {
						continue;
					}

					const id = imageId(thumb.url);
					gone.delete(id);
					const {thumb: _thumb, ...meta} = thumb;
					const old = items.find((item) => item.url === thumb.url);
					writes[thumbKey(id)] = {v: 1, ...thumb};
					items.splice(
						0,
						items.length,
						...items.filter((item) => item.url !== thumb.url),
						{...meta, id, held: old?.held ?? 0},
					);
				}

				if (Object.keys(writes).length > 0) {
					await storage.set({...writes, ...indexValue(items)});
				}

				await drop(
					items,
					items.filter((item) => gone.has(item.id)),
				);
			}),

		all: () =>
			serial(async () => {
				const images: SavedImage[] = [];
				for (const entry of await readIndex()) {
					const image = await readOriginal(entry);
					if (image) {
						images.push(image);
					}
				}

				return images;
			}),

		restore: (values: readonly unknown[]) =>
			serial(async () => {
				const items = await readIndex();
				let kept = 0;
				for (const value of values) {
					if ((await place(items, value)).ok) {
						kept += 1;
					}
				}

				return kept;
			}),
	};
}
