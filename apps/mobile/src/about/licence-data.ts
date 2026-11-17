/*
The shape of src/about/licences.generated.json, which scripts/licences.mts writes from the release build. Types only,
so the Node scripts that write it can import it too.
*/
export type LicenceData = {
	packages: Array<{
		name: string;
		version: string;
		licence: string;
		url?: string;
		/**
		A library on the Android classpath rather than an npm package.
		*/
		native?: true;
		/**
		Index into `texts`.
		*/
		text: number;
	}>;
	texts: string[];
};

export type LicenceEntry = LicenceData['packages'][number];
