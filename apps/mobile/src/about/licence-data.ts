export type LicenceData = {
	packages: Array<{
		name: string;
		version: string;
		licence: string;
		url?: string;
		native?: true;
		text: number;
	}>;
	texts: string[];
};

export type LicenceEntry = LicenceData['packages'][number];
