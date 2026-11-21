import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const dir = process.argv[2];
const scenarios = [
	'bookmarks-100',
	'bookmarks-1000',
	'bookmarks-10000',
	'columns-120x120',
	'sessions-100',
	'sessions-1000',
	'sessions-10000',
	'links-100',
	'links-1000',
	'links-10000',
	'folders-100',
];
const read = (name) =>
	existsSync(path.join(dir, name))
		? readFileSync(path.join(dir, name), 'utf8')
		: '';
const lines = (text) =>
	text
		.split('\n')
		.filter((line) => line.startsWith('{'))
		.map((line) => JSON.parse(line));
const median = (values) => {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : undefined;
};

const step = (records, name) =>
	records.find((record) => record.step === name)?.ms;
const fmt = (value) =>
	value === undefined ? 'n/a' : Math.round(value).toLocaleString('en-US');

const rows = [];
for (const scenario of scenarios) {
	const a = lines(read(`${scenario}.A.log`));
	const b = lines(read(`${scenario}.B.log`));
	const d = lines(read(`${scenario}.D.log`));
	const raw = [
		read(`${scenario}.A.log`),
		read(`${scenario}.B.log`),
		read(`${scenario}.D.log`),
	].join('\n');
	const bundle = b.find((record) => record.mark === 'bundle-start')?.at;
	const firstRows = b.find(
		(record) =>
			record.mark === 'bookmarks-first-rows' ||
			record.mark === 'sessions-first-rows',
	);
	const tab = b.find((record) => record.mark === 'tab-press')?.at;
	const sessionRows = b.find(
		(record) => record.mark === 'sessions-first-rows',
	)?.at;
	const cold =
		tab && sessionRows
			? `${fmt(sessionRows - tab)} (tab)`
			: bundle && firstRows
				? fmt(firstRows.at - bundle)
				: 'n/a';
	const keys = d.filter((record) => record.mark === 'search-key');
	const commits = d.filter((record) => record.mark === 'search-commit');
	const frames = d.filter((record) => record.mark === 'search-frame');
	const perKey = (ends) =>
		median(
			keys
				.map((key) => {
					const end = ends.find(
						(candidate) =>
							candidate.length === key.length && candidate.at >= key.at,
					);
					return end ? end.at - key.at : undefined;
				})
				.filter((value) => value !== undefined),
		);
	const scroll = read(`${scenario}.C.txt`);
	const jank = /Janky frames: \d+ \(([\d.]+)%\)/.exec(scroll)?.[1];
	const p50 = /50th percentile: (\d+)ms/.exec(scroll)?.[1];
	const frameCount = /Total frames rendered: (\d+)/.exec(scroll)?.[1];
	const problems = [
		/TIMEOUT/.test(raw) && 'timeout',
		/perf-error/.test(raw) && `error: ${/"error":"([^"]*)"/.exec(raw)?.[1]}`,
		/CRASH/.test(raw) && 'crash',
		/no (?:bookmark|session) rows/.test(raw) && 'no rows',
	].filter(Boolean);
	rows.push({
		scenario,
		seed: /push ([\d.]+)s/.exec(read(`${scenario}.seed.txt`))?.[1] ?? 'n/a',
		pull: step(a, 'sync-pull'),
		load: step(b, 'load-library'),
		cold,
		am: /TotalTime: (\d+)/.exec(read(`${scenario}.B.log`))?.[1],
		scroll: p50 ? `${frameCount} fr, p50 ${p50} ms, ${jank}% janky` : 'n/a',
		searchCommit: perKey(commits),
		searchFrame: perKey(frames),
		edit: step(a, 'edit'),
		push: step(a, 'sync-push'),
		exportMs: step(a, 'export'),
		exportKb: a.find((record) => record.step === 'export-size')?.bytes,
		importRead: step(a, 'import-backup'),
		import1000: [
			'import-parse-1000',
			'import-preview-1000',
			'import-apply-1000',
		].every((name) => step(a, name) !== undefined)
			? [
					'import-parse-1000',
					'import-preview-1000',
					'import-apply-1000',
				].reduce((sum, name) => sum + step(a, name), 0)
			: undefined,
		normalize: step(a, 'normalizeStore'),
		allB: step(a, 'allBookmarks'),
		searchB: step(a, 'searchBookmarks'),
		searchS: step(a, 'searchSessions'),
		folders: step(a, 'sessionFolders'),
		sessionsIn: step(a, 'sessionsIn'),
		widget: step(a, 'widgetSnapshot'),
		searchBAgain: step(a, 'searchBookmarks-again'),
		searchSAgain: step(a, 'searchSessions-again'),
		missFirst: step(a, 'searchElsewhere-miss'),
		missAgain: step(a, 'searchElsewhere-miss-again'),
		library: (() => {
			const l = a.find((record) => record.step === 'library');
			return l
				? `${l.bookmarks} bm, ${l.columns} col, ${l.sessions} ses, ${l.links} links, ${l.folders} fold`
				: 'n/a';
		})(),
		problems: problems.join('; ') || 'none',
	});
}

const table = (title, columns) => {
	console.log(`\n**${title}**\n`);
	console.log(`| Scenario | ${columns.map(([name]) => name).join(' | ')} |`);
	console.log(`| --- | ${columns.map(() => '---').join(' | ')} |`);
	for (const row of rows) {
		console.log(
			`| ${row.scenario} | ${columns.map(([, get]) => get(row)).join(' | ')} |`,
		);
	}
};

table('User-visible', [
	['Cold start to rows (ms)', (r) => r.cold],
	[
		'Launch (am start, ms)',
		(r) => fmt(r.am === undefined ? undefined : Number(r.am)),
	],
	['Scroll', (r) => r.scroll],
	['Search key → render (ms)', (r) => fmt(r.searchCommit)],
	['Search key → frame (ms)', (r) => fmt(r.searchFrame)],
	['One edit saved (ms)', (r) => fmt(r.edit)],
	['Library on the phone', (r) => r.library],
	['Problems', (r) => r.problems],
]);
table('Sync, import, export', [
	['Pull whole library (ms)', (r) => fmt(r.pull)],
	['Push one edit (ms)', (r) => fmt(r.push)],
	['Export backup (ms)', (r) => fmt(r.exportMs)],
	[
		'Backup (KB)',
		(r) => fmt(r.exportKb === undefined ? undefined : r.exportKb / 1024),
	],
	['Read backup (ms)', (r) => fmt(r.importRead)],
	['Import 1,000 links (ms)', (r) => fmt(r.import1000)],
]);
table('Work in the JS thread (ms, Hermes)', [
	['Read saved library', (r) => fmt(r.load)],
	['normalizeStore', (r) => fmt(r.normalize)],
	['allBookmarks', (r) => fmt(r.allB)],
	['search bookmarks', (r) => fmt(r.searchB)],
	['search sessions', (r) => fmt(r.searchS)],
	['sessionFolders', (r) => fmt(r.folders)],
	['sessionsIn', (r) => fmt(r.sessionsIn)],
	['widget snapshot', (r) => fmt(r.widget)],
	['search bookmarks again', (r) => fmt(r.searchBAgain)],
	['search sessions again', (r) => fmt(r.searchSAgain)],
	['search elsewhere (no match)', (r) => fmt(r.missFirst)],
	['search elsewhere again', (r) => fmt(r.missAgain)],
]);
