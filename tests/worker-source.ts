import {resolve} from 'node:path';
import {build} from 'vite-plus';
import {scriptConfig} from '../scripts/vite-shared';

/**
The service worker as the browser runs it: one classic script with its `src/app` imports bundled in. Built
in memory, once per test file, so the tests exercise the same code as `vp run build`.
*/
export async function buildWorkerSource(): Promise<string> {
	const config = scriptConfig({
		entry: resolve(import.meta.dirname, '..', 'extension', 'service-worker.ts'),
		outDir: resolve(
			import.meta.dirname,
			'..',
			'node_modules',
			'.tmp',
			'worker-test',
		),
		fileName: 'service-worker.js',
		target: 'chrome',
	});
	const result = await build({
		...config,
		mode: 'production',
		build: {...config.build, write: false},
	});
	const outputs = Array.isArray(result) ? result : [result];
	for (const output of outputs) {
		if (!('output' in output)) {
			continue;
		}

		const chunk = output.output.find((item) => item.type === 'chunk');
		if (chunk && 'code' in chunk) {
			return chunk.code;
		}
	}

	throw new Error('The service worker build produced no script.');
}
