import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {DEFAULTS, type LinkSettings} from '../src/library/links';
import {addSession, archiveStale} from '../src/library/session-edits';
import {defaultSessionName} from '../src/library/session-name';
import {emptyStore} from '../src/library/store-shape';

const DAY = 86_400_000;
const NOW = new Date('2026-03-14T10:30:00Z').getTime();
const settings = (extra: Partial<LinkSettings>): LinkSettings => ({
	...DEFAULTS,
	...extra,
});

test('a new session is named by the style setting, as the extension names it', () => {
	const links = [{url: 'https://www.example.com/a', title: '(3) Example page'}];
	const now = new Date(NOW);
	assert.equal(
		defaultSessionName(settings({sessionNameStyle: 'title'}), links, now),
		'Example page',
	);
	assert.equal(
		defaultSessionName(
			settings({
				sessionNameStyle: 'custom',
				sessionNameTemplate: '{domain} ({count})',
			}),
			[...links, {url: 'https://b.test/'}],
			now,
		),
		'example.com (2)',
	);
	assert.equal(
		defaultSessionName(
			settings({sessionNameStyle: 'ask', sessionNameFallback: 'title'}),
			links,
			now,
		),
		'Example page',
	);
});

test('a link with no title is named by its domain', () => {
	assert.equal(
		defaultSessionName(
			settings({sessionNameStyle: 'title'}),
			[{url: 'https://www.example.com/a'}],
			new Date(NOW),
		),
		'example.com',
	);
});

function library(autoArchiveDays: number) {
	let store = emptyStore(NOW - 100 * DAY);
	store = addSession(
		store,
		{name: 'Old', urls: ['https://a.test/']},
		'old',
		['t1'],
		NOW - 60 * DAY,
	);
	store = addSession(
		store,
		{name: 'Recent', urls: ['https://b.test/']},
		'recent',
		['t2'],
		NOW - 5 * DAY,
	);
	return {...store, settings: {...store.settings, autoArchiveDays}};
}

test('sessions idle for the setting move to Archived, nothing is deleted, and updatedAt stays', () => {
	const before = library(30);
	const after = archiveStale(before, NOW);
	const archived = after.folders.find((folder) => folder.name === 'Archived');
	assert.ok(archived);
	const byId = (id: string) => after.groups.find((group) => group.id === id);
	assert.equal(byId('old')?.folderId, archived.id);
	assert.notEqual(byId('recent')?.folderId, archived.id);
	assert.equal(after.groups.length, 2);
	assert.equal(byId('old')?.updatedAt, NOW - 60 * DAY);
});

test('a session opened lately is not archived, and never means never', () => {
	const opened = library(30);
	opened.groups[1] = {...opened.groups[1], lastOpenedAt: NOW - DAY};
	assert.equal(
		archiveStale(opened, NOW).groups[1].folderId,
		opened.groups[1].folderId,
	);
	const never = library(0);
	assert.equal(archiveStale(never, NOW), never);
});
