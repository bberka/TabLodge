import assert from 'node:assert/strict';
import {beforeEach, test} from 'vite-plus/test';
import type {NativeScrollEvent, NativeSyntheticEvent} from 'react-native';
import {isScrolledDown, resetScroll, trackScroll} from '../src/scroll-state';

const scrollTo = (y: number) => {
	trackScroll({
		nativeEvent: {contentOffset: {x: 0, y}},
	} as NativeSyntheticEvent<NativeScrollEvent>);
};

beforeEach(() => {
	resetScroll();
});

test('scrolling down past the top marks the page as scrolled', () => {
	scrollTo(60);
	assert.equal(isScrolledDown(), true);
});

test('scrolling back up clears it, and so does reaching the top', () => {
	scrollTo(400);
	scrollTo(380);
	assert.equal(isScrolledDown(), false);
	scrollTo(500);
	assert.equal(isScrolledDown(), true);
	scrollTo(10);
	assert.equal(isScrolledDown(), false);
});

test('small jitter does not flip the state', () => {
	scrollTo(300);
	scrollTo(296);
	scrollTo(302);
	assert.equal(isScrolledDown(), true);
});

test('switching screens forgets the scroll', () => {
	scrollTo(300);
	resetScroll();
	assert.equal(isScrolledDown(), false);
});
