import {type BrowserContext, type Locator, type Page} from 'playwright';
import {failures, type THEMES, until, watchConsole} from './harness.ts';

export const AXE_TAGS = [
	'wcag2a',
	'wcag2aa',
	'wcag21a',
	'wcag21aa',
	'wcag22aa',
];

type AxeResults = {
	violations: Array<{
		id: string;
		help: string;
		nodes: Array<{target: unknown[]; failureSummary?: string}>;
	}>;
};

type AxeOptions = {runOnly: {type: 'rule' | 'tag'; values: string[]}};

export type AxeGlobal = {axe: {run(options: AxeOptions): Promise<AxeResults>}};

export type ScrollElement = {scrollHeight: number; clientHeight: number};

export type ScrollViewport = typeof globalThis & {
	scrollY: number;
	scrollTo(x: number, y: number): void;
};

export async function selectQuickActions(
	page: Page,
	menu: Locator,
	labels: string[],
	kind: 'session' | 'bookmark',
) {
	for (const label of labels) {
		const option = menu.getByRole('button', {
			name: `Add ${label}`,
			exact: true,
		});
		await option.focus();
		await page.keyboard.press('Enter');
		await until(
			async () => (await option.count()) === 0,
			`${label} ${kind} action to be selected`,
		);
	}
}

export async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
	await page.emulateMedia({colorScheme: theme});
	await page.evaluate(async () => {
		const {document, requestAnimationFrame} =
			globalThis as typeof globalThis & {
				document: {getAnimations(): Array<{finished: Promise<unknown>}>};
				requestAnimationFrame(callback: () => void): number;
			};
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					resolve();
				});
			});
		});
		await Promise.allSettled(
			document.getAnimations().map(async (animation) => animation.finished),
		);
	});
}

export async function openMenuByKeyboard(page: Page, trigger: Locator) {
	const menu = page.getByRole('menu');
	await until(async () => {
		if ((await menu.count()) > 0) {
			return true;
		}

		await trigger.focus();
		await page.keyboard.press('Enter');
		return (await menu.count()) > 0;
	}, 'the menu to open');
}

export async function openMenuItemByKeyboard(
	page: Page,
	trigger: Locator,
	name: string,
) {
	await openMenuByKeyboard(page, trigger);
	await page.getByRole('menuitem', {name, exact: true}).focus();
	await page.keyboard.press('Enter');
}

export async function openPage(
	context: BrowserContext,
	extensionId: string,
	name: string,
) {
	const page = await context.newPage();
	watchConsole(page, `${name} page`);
	page.on('pageerror', (error) => {
		failures.push(`${name}: ${error.message}`);
		console.log(`FAIL ${name} page error: ${error.message}`);
	});
	await page.setViewportSize({width: 1280, height: 900});
	await page.goto(`chrome-extension://${extensionId}/${name}.html`);
	await page.waitForLoadState('networkidle');
	return page;
}

async function waitForFiniteAnimations(page: Page) {
	await page.evaluate(async () => {
		const {document} = globalThis as typeof globalThis & {
			document: {
				getAnimations(): Array<{
					finished: Promise<unknown>;
					effect?: {getTiming?: () => {iterations?: number}} | null;
				}>;
			};
		};
		const finite = document
			.getAnimations()
			.filter(
				(animation) => animation.effect?.getTiming?.().iterations !== Infinity,
			);
		await Promise.allSettled(
			finite.map(async (animation) => animation.finished),
		);
	});
}

export async function axeViolationLines(
	page: Page,
	source: string,
	runOnly: AxeOptions['runOnly'] = {type: 'tag', values: AXE_TAGS},
) {
	await waitForFiniteAnimations(page);
	await page.evaluate(source);
	const results = await page.evaluate(
		async (options: AxeOptions['runOnly']) =>
			(globalThis as typeof globalThis & AxeGlobal).axe.run({
				runOnly: options,
			}),
		runOnly,
	);
	return results.violations.map(
		(violation) =>
			`${violation.id}: ${violation.help} (${violation.nodes.length}) targets: ${violation.nodes.map((node) => `${node.target.join(' ')} ${node.failureSummary ?? ''}`).join(', ')}`,
	);
}

export const attributes = (page: Page, selector: string, name: string) =>
	page
		.locator(selector)
		.evaluateAll(
			(
				nodes: Array<{getAttribute(name: string): string | null}>,
				attribute: string,
			) => nodes.map((node) => node.getAttribute(attribute)),
			name,
		);

export const focusedLabel = (page: Page) =>
	page.locator(':focus').getAttribute('aria-label');
