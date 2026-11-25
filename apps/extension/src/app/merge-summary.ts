import {plural} from './plural';

export type MergeResult = {
	groups: number;
	count: number;
	bookmarks: number;
	columns: number;
	skipped: number;
	updatedTitles: number;
};

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
