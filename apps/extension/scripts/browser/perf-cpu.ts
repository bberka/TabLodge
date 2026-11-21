/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, no-promise-executor-return, unicorn/no-array-sort -- This is a measurement script. Most of it is code run inside the page or the worker (no extension or DOM types here) and untyped DevTools protocol replies; typing them adds nothing. It is never part of the bundle. */
import process from 'node:process';

const [endpoint, targetKind, action] = process.argv.slice(2);
const version = (await (await fetch(`${endpoint}/json/version`)).json()) as {
	webSocketDebuggerUrl: string;
};
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve));
let id = 0;
const pending = new Map<number, (value: any) => void>();
socket.addEventListener('message', (event) => {
	const message = JSON.parse(String(event.data));
	pending.get(message.id)?.(message);
});
const call = (method: string, params: object = {}, sessionId?: string) =>
	new Promise<any>((resolve) => {
		id += 1;
		pending.set(id, resolve);
		socket.send(JSON.stringify({id, method, params, sessionId}));
	});

const {result: targets} = await call('Target.getTargets');
const list = targets.targetInfos as Array<{
	targetId: string;
	type: string;
	url: string;
}>;
const worker = list.find(
	(t) => t.type === 'service_worker' && t.url.endsWith('service-worker.js'),
)!;
const pageTarget = list.find(
	(t) => t.type === 'page' && t.url.includes('/newtab.html'),
)!;
const attach = async (targetId: string) =>
	(await call('Target.attachToTarget', {targetId, flatten: true})).result
		.sessionId as string;
const workerSession = await attach(worker.targetId);
const pageSession = await attach(pageTarget.targetId);

const session = targetKind === 'worker' ? workerSession : pageSession;
await call('Profiler.enable', {}, session);
await call('Profiler.setSamplingInterval', {interval: 200}, session);
await call('Profiler.start', {}, session);

const evalPage = (expression: string) =>
	call(
		'Runtime.evaluate',
		{expression, awaitPromise: true, returnByValue: true},
		pageSession,
	);

switch (action) {
	case 'getstate': {
		await evalPage(
			"chrome.runtime.sendMessage({type:'GET_STATE'}).then(()=>1)",
		);

		break;
	}

	case 'edit': {
		await evalPage(
			"chrome.runtime.sendMessage({type:'UPDATE_BOOKMARK',bookmarkId:'perf-bookmark-5',fields:{notes:'cpu '+Date.now()}}).then(()=>1)",
		);

		break;
	}

	case 'load': {
		void evalPage('location.reload()');
		await new Promise((resolve) => setTimeout(resolve, 6000));

		break;
	}

	case 'reload': {
		void evalPage('location.reload()');
		await new Promise((resolve) => setTimeout(resolve, 7000));

		break;
	}

	case 'rerender': {
		await evalPage(
			"chrome.runtime.sendMessage({type:'UPDATE_BOOKMARK',bookmarkId:'perf-bookmark-9',fields:{notes:'r '+Date.now()}}).then(()=>new Promise(r=>setTimeout(r,2000)))",
		);

		break;
	}

	case 'search': {
		await evalPage(
			"(async()=>{const i=document.querySelector('input[aria-label=\"Search bookmarks\"], input[type=\"search\"], input[placeholder*=\"earch\"]');if(!i)throw new Error('The search input is not mounted; open the search first.');const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;let v='';for(const l of 'performance guide'){v+=l;s.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>setTimeout(r)));}return 1})()",
		);

		break;
	}
}

const {result} = await call('Profiler.stop', {}, session);
const profile = result.profile as {
	nodes: Array<{
		id: number;
		callFrame: {functionName: string; url: string; lineNumber: number};
	}>;
	samples: number[];
	timeDeltas: number[];
};
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map<string, number>();
let total = 0;
for (const [index, sample] of profile.samples.entries()) {
	const delta = profile.timeDeltas[index] / 1000;
	const frame = byId.get(sample)!.callFrame;
	const key = `${frame.functionName || '(anon)'} ${frame.url.split('/').pop()}:${frame.lineNumber}`;
	self.set(key, (self.get(key) ?? 0) + delta);
	total += delta;
}

console.log(`total sampled ms: ${Math.round(total)}`);
for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
	console.log(`${Math.round(ms).toString().padStart(6)} ms  ${key}`);
}

socket.close();
