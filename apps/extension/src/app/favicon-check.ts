export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) {
		return false;
	}

	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}

	return true;
}

export type MissingIconCache = {
	knownMissing(host: string): boolean | undefined;
	isMissing(host: string, iconUrl: string): Promise<boolean>;
};

export function createMissingIconCache(options: {
	fetchBytes(url: string): Promise<Uint8Array>;
	defaultUrl: string;
	maxHosts?: number;
	onResolved?(host: string, missing: boolean): void;
}): MissingIconCache {
	const {fetchBytes, defaultUrl, maxHosts = 2000, onResolved} = options;
	const known = new Map<string, boolean>();
	const pending = new Map<string, Promise<boolean>>();
	let defaultBytes: Promise<Uint8Array> | undefined;

	const remember = (host: string, missing: boolean) => {
		if (known.has(host)) {
			known.delete(host);
		} else if (known.size >= maxHosts) {
			const oldest = known.keys().next().value;
			if (oldest !== undefined) {
				known.delete(oldest);
			}
		}

		known.set(host, missing);
	};

	const loadDefault = () => {
		defaultBytes ??= fetchBytes(defaultUrl).catch((error: unknown) => {
			defaultBytes = undefined;
			throw error;
		});
		return defaultBytes;
	};

	return {
		knownMissing(host: string) {
			return known.get(host);
		},
		async isMissing(host: string, iconUrl: string) {
			const cached = known.get(host);
			if (cached !== undefined) {
				return cached;
			}

			let active = pending.get(host);
			if (!active) {
				active = (async () => {
					try {
						let pair: [Uint8Array, Uint8Array];
						try {
							pair = await Promise.all([fetchBytes(iconUrl), loadDefault()]);
						} catch {
							return false;
						}

						const missing = sameBytes(pair[0], pair[1]);
						remember(host, missing);
						onResolved?.(host, missing);
						return missing;
					} finally {
						pending.delete(host);
					}
				})();
				pending.set(host, active);
			}

			return active;
		},
	};
}
