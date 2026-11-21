import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {importFromLink} from '../../extension/src/shared/import-link';
import {cappedFetch, type ReadRequest} from '../src/transfer/capped-fetch';

type Listener = (event: {loaded: number}) => void;

function fakeRequest(script: (request: FakeRequest) => void) {
	return () => new FakeRequest(script);
}

class FakeRequest implements ReadRequest {
	private readonly listeners = new Map<string, Listener[]>();
	status = 0;
	responseText = '';
	withCredentials = true;
	onprogress: XMLHttpRequest['onprogress'] = null;
	aborted = false;
	url = '';

	constructor(private readonly script: (request: FakeRequest) => void) {}

	open(_method: string, url: string) {
		this.url = url;
	}

	send() {
		this.script(this);
	}

	abort() {
		this.aborted = true;
	}

	addEventListener(type: string, listener: Listener) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	emit(type: string, loaded = 0) {
		if (type === 'progress') {
			this.onprogress?.call(
				this as unknown as XMLHttpRequest,
				{loaded} as ProgressEvent,
			);
		}

		for (const listener of this.listeners.get(type) ?? []) {
			listener({loaded});
		}
	}
}

const PAGE = 'https://sync.example.test/p/AAAAAAAAAAAAAAAAAAAAAA';

describe('the phone reads a link with a size cap', () => {
	test('a page arrives as a response, without cookies', async () => {
		let made: FakeRequest | undefined;
		const send = cappedFetch(() => {
			made = new FakeRequest((request) => {
				request.status = 200;
				request.responseText = 'https://a.example/\nhttps://b.example/';
				request.emit('load');
			});
			return made;
		});
		const parsed = await importFromLink(send, PAGE);
		assert.equal(made?.withCredentials, false);
		assert.equal(made?.url, PAGE);
		assert.equal(parsed.bookmarks.flatMap((group) => group.links).length, 2);
	});

	test('a body past the cap is stopped while it downloads, without Content-Length', async () => {
		let stopped: FakeRequest | undefined;
		const send = cappedFetch(() => {
			stopped = new FakeRequest((request) => {
				request.emit('progress', 600);
				request.emit('progress', 1200);
			});
			return stopped;
		}, 1000);
		await assert.rejects(importFromLink(send, PAGE), /larger than 45 MB/);
		assert.equal(stopped?.aborted, true);
	});

	test('a cancelled read stops the download', async () => {
		let running: FakeRequest | undefined;
		const controller = new AbortController();
		const send = cappedFetch(() => {
			running = new FakeRequest(() => {
				controller.abort();
			});
			return running;
		});
		await assert.rejects(
			importFromLink(send, PAGE, {signal: controller.signal}),
			/Could not read that link/,
		);
		assert.equal(running?.aborted, true);
	});

	test('a failed request is a readable error', async () => {
		await assert.rejects(
			importFromLink(
				cappedFetch(
					fakeRequest((request) => {
						request.emit('error');
					}),
				),
				PAGE,
			),
			/Could not read that link/,
		);
	});
});
