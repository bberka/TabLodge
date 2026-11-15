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

// The pages follow the system theme by default, so emulating the color scheme switches them.
export async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
	await page.emulateMedia({colorScheme: theme});
	// Colors transition between themes; measure contrast after they settle.
	await page.evaluate(async () => {
		const {document, requestAnimationFrame} =
			globalThis as typeof globalThis & {
				document: {getAnimations(): Array<{finished: Promise<unknown>}>};
				requestAnimationFrame(callback: () => void): number;
			};
		// The style change applies on the next frame, which is when its transitions start.
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

// Opens a menu from its trigger by keyboard. A card can redraw right after the page settles and drop
// focus, so the key press is repeated until a menu is open. An open menu hides the trigger from the
// accessibility tree, so the menu itself is checked rather than the trigger.
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

export async function axeViolationLines(
	page: Page,
	source: string,
	runOnly: AxeOptions['runOnly'] = {type: 'tag', values: AXE_TAGS},
) {
	// Evaluated through the protocol because the extension CSP blocks inline scripts.
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

// The control holding keyboard focus, by its accessible name.
export const focusedLabel = (page: Page) =>
	page.locator(':focus').getAttribute('aria-label');
