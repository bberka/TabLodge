import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	SAVE_TARGET_CHOICES,
	SHARE_MODE_CHOICES,
} from '../src/shared/choice-copy';

test('the link type choices keep the stored values and say what each does', () => {
	assert.deepEqual(
		SHARE_MODE_CHOICES.map(({value, title, description}) => [
			value,
			title,
			description,
		]),
		[
			['snapshot', 'Snapshot', 'A frozen copy of what you share now.'],
			['live', 'Live link', 'The page updates after your edits sync.'],
		],
	);
});

test('the save target choices keep the stored values and describe both', () => {
	assert.deepEqual(
		SAVE_TARGET_CHOICES.map(({value, title}) => [value, title]),
		[
			['bookmark', 'Bookmark column'],
			['session', 'Session'],
		],
	);
	for (const choice of SAVE_TARGET_CHOICES) {
		assert.notEqual(choice.description, '');
	}
});
