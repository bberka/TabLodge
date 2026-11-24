import {
	ImportFormatError,
	parseImportFile,
	type ParsedImport,
} from '../shared/import-formats';

export type PastedReading =
	{ok: true; parsed: ParsedImport} | {ok: false; message: string} | undefined;

export function readPastedImport(text: string): PastedReading {
	if (text.trim() === '') {
		return undefined;
	}

	try {
		return {ok: true, parsed: parseImportFile(text, '')};
	} catch (error) {
		return {
			ok: false,
			message:
				error instanceof ImportFormatError
					? error.message
					: 'Could not read that text.',
		};
	}
}
