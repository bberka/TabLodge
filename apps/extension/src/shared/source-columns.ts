// Source columns (#295): the bookmark column each Sources site saves into. Its id, `source-<site>`, is the marker, so
// the column record keeps the shape every released app knows: they keep the id through sync, backups, and edits, and
// two devices that create it write the same record. Shared with the Android app, which shows the site's name.
import type {IconId} from './icon-ids';

export type SiteSourceId =
	| 'youtube'
	| 'reddit'
	| 'x'
	| 'instagram'
	| 'github'
	| 'hackernews'
	| 'stackoverflow'
	| 'devto'
	| 'lobsters'
	| 'bluesky'
	| 'soundcloud'
	| 'spotify'
	| 'letterboxd'
	| 'imdb'
	| 'goodreads'
	| 'medium'
	| 'substack';

/**
What a site's column gets when a save creates it. The user can rename it and change both icon and color later.
`color` is a preset accent id or a lowercase `#rrggbb`, as a column color takes.
*/
export type SourceColumnLook = {name: string; icon: IconId; color: string};

export const SOURCE_COLUMNS: Readonly<Record<SiteSourceId, SourceColumnLook>> =
	{
		youtube: {name: 'YouTube', icon: 'video', color: '#ff0000'},
		reddit: {name: 'Reddit', icon: 'message-circle', color: '#ff4500'},
		x: {name: 'X', icon: 'message-square', color: 'slate'},
		instagram: {name: 'Instagram', icon: 'camera', color: '#e1306c'},
		github: {name: 'GitHub', icon: 'git-branch', color: '#24292f'},
		hackernews: {name: 'Hacker News', icon: 'newspaper', color: '#ff6600'},
		stackoverflow: {name: 'Stack Overflow', icon: 'layers', color: '#f48024'},
		devto: {name: 'dev.to', icon: 'code', color: '#3b49df'},
		lobsters: {name: 'Lobsters', icon: 'rss', color: '#ac130d'},
		bluesky: {name: 'Bluesky', icon: 'cloud', color: '#1185fe'},
		soundcloud: {name: 'SoundCloud', icon: 'headphones', color: '#ff5500'},
		spotify: {name: 'Spotify', icon: 'music', color: '#1db954'},
		letterboxd: {name: 'Letterboxd', icon: 'film', color: '#00c030'},
		imdb: {name: 'IMDb', icon: 'clapperboard', color: '#f5c518'},
		goodreads: {name: 'Goodreads', icon: 'library', color: '#8b5a2b'},
		medium: {name: 'Medium', icon: 'file-text', color: '#000000'},
		substack: {name: 'Substack', icon: 'mail', color: '#ff6719'},
	};

const PREFIX = 'source-';

export const sourceColumnId = (site: SiteSourceId) => `${PREFIX}${site}`;

/**
Whether a column id is a source column's, including one for a site this version does not know. Imports keep such an
id, so the marker survives an export from a newer version.
*/
export const isSourceColumnId = (columnId: string) =>
	columnId.startsWith(PREFIX) && columnId.length > PREFIX.length;

/**
The site a column is the source column of. A `source-` id this version does not know behaves as a plain column.
*/
export function sourceColumnSite(columnId: string): SiteSourceId | undefined {
	const site = columnId.startsWith(PREFIX) ? columnId.slice(PREFIX.length) : '';
	return Object.hasOwn(SOURCE_COLUMNS, site)
		? (site as SiteSourceId)
		: undefined;
}
