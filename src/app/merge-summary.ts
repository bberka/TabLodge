import {plural} from './plural';

/**
What an import that merges into the library reports back (the worker's IMPORT_GROUPS answer).
*/
export type MergeResult = {
	groups: number;
	count: number;
	bookmarks: number;
	columns: number;
	skipped: number;
	updatedTitles: number;
};

/**
One line for the toast after adding a backup's sessions and bookmarks to the library: what was added, then what was
skipped because it was already there.
*/
export function mergeSummary(result: MergeResult): string {
	const added: string[] = [];
	if (result.groups > 0) {
		added.push(
			`${plural(result.count, 'tab')} in ${plural(result.groups, 'session')}`,
		);
	}

	if (result.bookmarks > 0) {
		added.push(plural(result.bookmarks, 'bookmark'));
	}

	if (result.columns > 0) {
		added.push(plural(result.columns, 'new column'));
	}

	const parts = [
		added.length > 0 ? `Added ${added.join(' · ')}` : 'Nothing new to add',
	];
	if (result.skipped > 0) {
		parts.push(`skipped ${plural(result.skipped, 'duplicate')}`);
	}

	if (result.updatedTitles > 0) {
		parts.push(`updated ${plural(result.updatedTitles, 'title')}`);
	}

	return `${parts.join(' · ')}.`;
}
