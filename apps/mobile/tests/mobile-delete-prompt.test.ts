import assert from 'node:assert/strict';
import {beforeEach, describe, test, vi} from 'vite-plus/test';
import {DEFAULT_SETTINGS} from '../../extension/src/shared/library-normalize';
import type {Store} from '../../extension/src/shared/types';

const asked: Array<{title: string; label: string; confirm: () => void}> = [];
let regular = {settings: DEFAULT_SETTINGS} as Store;
let isPrivate = false;

vi.mock('../src/ui/dialog', () => ({
	confirm(
		title: string,
		_message: string,
		action: {label: string},
		onConfirm: () => void,
	) {
		asked.push({title, label: action.label, confirm: onConfirm});
	},
}));
vi.mock('../src/library/library-store', () => ({getLibrary: () => regular}));
vi.mock('../src/library/view', () => ({isPrivateView: () => isPrivate}));

const {askBeforeDeleting} = await import('../src/library/delete-prompt');

const question = {title: 'Delete bookmark “Docs”?', description: 'Undo.'};

const choose = (value: boolean) => {
	regular = {
		settings: {...DEFAULT_SETTINGS, askBeforeDeleting: value},
	} as Store;
};

beforeEach(() => {
	asked.length = 0;
	isPrivate = false;
});

describe('deleting on the phone', () => {
	test('runs at once when Ask before deleting is off', () => {
		choose(false);
		let deleted = 0;
		askBeforeDeleting(question, () => deleted++);
		assert.equal(deleted, 1);
		assert.equal(asked.length, 0);
	});

	test('waits for Delete when it is on, so Cancel changes nothing', () => {
		choose(true);
		let deleted = 0;
		askBeforeDeleting(question, () => deleted++);
		assert.equal(deleted, 0);
		assert.equal(asked[0]?.title, question.title);
		assert.equal(asked[0]?.label, 'Delete');
		asked[0]?.confirm();
		assert.equal(deleted, 1);
	});

	test('deletes nothing when the library switched while it asked', () => {
		choose(true);
		isPrivate = true;
		let deleted = 0;
		askBeforeDeleting(question, () => deleted++);
		isPrivate = false;
		asked[0]?.confirm();
		assert.equal(deleted, 0);
	});
});
