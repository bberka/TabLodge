// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the worker project has no DOM types, and this function runs in a page
/// <reference lib="dom" />

export type CapturedImage =
	| {
			ok: true;
			type: string;
			width: number;
			height: number;
			data: string;
			thumb: string;
	  }
	| {ok: false; reason: 'blocked' | 'too-large' | 'unsupported'};

export async function captureImage(
	source: string,
	maxBytes: number,
	thumbSide: number,
	thumbBytes: number,
): Promise<CapturedImage> {
	const encode = async (blob: Blob) =>
		new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.addEventListener('load', () => {
				resolve(String(reader.result).replace(/^[^,]*,/, ''));
			});
			reader.addEventListener('error', () => {
				reject(new Error('unreadable'));
			});
			reader.readAsDataURL(blob);
		});

	let blob: Blob;
	try {
		const response = await fetch(source, {cache: 'force-cache'});
		if (!response.ok) {
			return {ok: false, reason: 'blocked'};
		}

		blob = await response.blob();
	} catch {
		return {ok: false, reason: 'blocked'};
	}

	if (blob.size > maxBytes) {
		return {ok: false, reason: 'too-large'};
	}

	try {
		const bitmap = await createImageBitmap(blob);
		const scale = Math.min(
			1,
			thumbSide / Math.max(bitmap.width, bitmap.height),
		);
		const draw = async (shrink: number, quality: number) => {
			const canvas = document.createElement('canvas');
			canvas.width = Math.max(1, Math.round(bitmap.width * scale * shrink));
			canvas.height = Math.max(1, Math.round(bitmap.height * scale * shrink));
			canvas
				.getContext('2d')
				?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			return new Promise<Blob | undefined>((resolve) => {
				canvas.toBlob(
					(result) => {
						resolve(result ?? undefined);
					},
					'image/webp',
					quality,
				);
			});
		};

		for (const [shrink, quality] of [
			[1, 0.8],
			[1, 0.6],
			[1, 0.4],
			[0.75, 0.4],
			[0.5, 0.4],
			[0.25, 0.3],
		]) {
			const thumb = await draw(shrink, quality);
			if (thumb && thumb.size <= thumbBytes) {
				return {
					ok: true,
					type: blob.type,
					width: bitmap.width,
					height: bitmap.height,

					data: await encode(blob),

					thumb: await encode(thumb),
				};
			}
		}
	} catch {
		return {ok: false, reason: 'unsupported'};
	}

	return {ok: false, reason: 'unsupported'};
}
