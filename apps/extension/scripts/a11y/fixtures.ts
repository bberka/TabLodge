import {createServer, type Server} from 'node:http';
import {type AddressInfo} from 'node:net';
import {type Page} from 'playwright';
import {
	createDevFixture as createBaseFixture,
	type DevStore,
} from '../../src/shared/dev-fixture.ts';

export type ExtensionApi = {
	runtime: {sendMessage(message: unknown): Promise<unknown>};
	storage: {local: {set(items: Record<string, unknown>): Promise<void>}};
	tabs: {
		query(info: {
			url?: string;
			active?: boolean;
			lastFocusedWindow?: boolean;
		}): Promise<unknown[]>;
	};
};

export async function readDevStore(page: Page) {
	const base = await page.evaluate(async () => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		return chrome.runtime.sendMessage({type: 'GET_STATE'});
	});
	const {ok: _ok, ...store} = base as {ok: boolean} & DevStore;
	return store;
}

export async function countTabs(page: Page, url: string) {
	return page.evaluate(async (address) => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		return (await chrome.tabs.query({url: address})).length;
	}, url);
}

export async function writeDevStore(page: Page, store: DevStore) {
	await page.evaluate(async (data) => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		await chrome.storage.local.set({'tablodge.state': data});
	}, store);
}

// The checks were written for the Board view; the real default is Focus, which the Focus checks set up themselves.
export function createDevFixture(base: DevStore): DevStore {
	const fixture = createBaseFixture(base);
	return {
		...fixture,
		settings: {...fixture.settings, bookmarkBoardView: 'board'},
	};
}

export async function seed(page: Page) {
	const fixture = createDevFixture(await readDevStore(page));
	fixture.settings = {
		...fixture.settings,
		limitBookmarksPerColumn: false,
		bookmarkColumnPageSize: 10,
	};
	await writeDevStore(page, fixture);
}

// Tiny local pages, so the test window has web tabs that a replace or append can read.
export async function startPageServer() {
	const server = createServer((request, response) => {
		response.setHeader('content-type', 'text/html');
		response.end(`<title>Local ${request.url}</title><h1>${request.url}</h1>`);
	});
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
	return {
		server,
		origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
	};
}

export async function closeServer(server: Server) {
	await new Promise<void>((resolve) => {
		server.close(() => {
			resolve();
		});
	});
}

export async function sessionUrls(page: Page, groupId: string) {
	const store = await readDevStore(page);
	return store.groups
		.find((group) => group.id === groupId)
		?.tabs.map((tab) => tab.url);
}

export async function groupFolderId(page: Page, groupId: string) {
	const state = (await page.evaluate(async () => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		return chrome.runtime.sendMessage({type: 'GET_STATE'});
	})) as {groups: Array<{id: string; folderId: string}>};
	return state.groups.find((group) => group.id === groupId)?.folderId;
}
