import type {ImageStorage} from '../src/shared/image-store';

export const PNG =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const WEBP = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

export const picture = (url = 'https://cdn.example/cat.png') => ({
	url,
	type: 'image/png',
	width: 640,
	height: 480,
	size: 1,
	savedAt: 1000,
	device: 'Desk',
	data: PNG,
	thumb: WEBP,
});

export function memoryStorage(): {
	storage: ImageStorage;
	data: Record<string, unknown>;
} {
	const data: Record<string, unknown> = {};
	return {
		data,
		storage: {
			async get(keys) {
				return Object.fromEntries(
					keys
						.filter((key) => Object.hasOwn(data, key))
						.map((key) => [key, structuredClone(data[key])]),
				);
			},
			async set(items) {
				Object.assign(data, structuredClone(items));
			},
			async remove(keys) {
				for (const key of keys) {
					Reflect.deleteProperty(data, key);
				}
			},
		},
	};
}
