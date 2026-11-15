import assert from 'node:assert/strict';
import {check, type Env, PAGES, THEMES} from './harness.ts';
import {axeViolationLines, openPage, setTheme} from './pages.ts';

export async function axeCheck(env: Env) {
	const {context, extensionId, axeSource} = env;
	for (const name of PAGES) {
		for (const theme of THEMES) {
			await check(`axe ${name} (${theme})`, async () => {
				const page = await openPage(context, extensionId, name);
				await setTheme(page, theme);
				const lines = await axeViolationLines(page, axeSource);
				await page.close();
				assert.deepEqual(lines, []);
			});
		}
	}
}
