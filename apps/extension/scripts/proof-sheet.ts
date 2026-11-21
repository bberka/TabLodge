import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, extname, join, resolve} from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {fromRoot} from './vite-shared.ts';

export const MAX_EDGE = 1568;
const GAP = 8;
const LABEL_HEIGHT = 30;

export type Size = {width: number; height: number};
export type Tile = Size & {x: number; y: number};
export type Sheet = Size & {tiles: Tile[]};

const usage =
	'Usage: vp run proof:sheet [--out <file.png>] <screenshot.png | folder>...';

function splitIntoRows(aspects: number[], rowCount: number): number[][] {
	const total = aspects.reduce((sum, aspect) => sum + aspect, 0);
	const rows: number[][] = Array.from({length: rowCount}, () => []);
	let before = 0;
	for (const [index, aspect] of aspects.entries()) {
		const row = Math.min(
			rowCount - 1,
			Math.floor(((before + aspect / 2) / total) * rowCount),
		);
		rows[row].push(index);
		before += aspect;
	}

	return rows.filter((row) => row.length > 0);
}

function placeRows(
	sizes: Size[],
	rows: number[][],
	maxEdge: number,
): Sheet | undefined {
	const aspects = sizes.map(({width, height}) => width / height);
	const heights = rows.map((row) => {
		const aspectSum = row.reduce((sum, index) => sum + aspects[index], 0);
		const fullWidth = (maxEdge - (row.length + 1) * GAP) / aspectSum;
		return Math.min(fullWidth, ...row.map((index) => sizes[index].height));
	});
	const fixed = rows.length * LABEL_HEIGHT + (rows.length + 1) * GAP;
	const imageHeight = heights.reduce((sum, height) => sum + height, 0);
	const scale = Math.min(1, (maxEdge - fixed) / imageHeight);
	if (scale <= 0) {
		return undefined;
	}

	const tiles: Tile[] = [];
	let y = GAP;
	let width = 0;
	for (const [rowIndex, row] of rows.entries()) {
		const height = Math.floor(heights[rowIndex] * scale);
		let x = GAP;
		for (const index of row) {
			const tileWidth = Math.max(1, Math.floor(height * aspects[index]));
			tiles[index] = {x, y, width: tileWidth, height};
			x += tileWidth + GAP;
		}

		width = Math.max(width, x);
		y += height + LABEL_HEIGHT + GAP;
	}

	return {width, height: y, tiles};
}

export function layoutSheet(sizes: Size[], maxEdge = MAX_EDGE): Sheet {
	if (sizes.length === 0) {
		throw new Error('A contact sheet needs at least one image.');
	}

	const aspects = sizes.map(({width, height}) => width / height);
	let best: Sheet | undefined;
	let bestArea = 0;
	for (let rowCount = 1; rowCount <= sizes.length; rowCount++) {
		const sheet = placeRows(sizes, splitIntoRows(aspects, rowCount), maxEdge);
		const area =
			sheet?.tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0) ??
			0;
		if (area <= bestArea) {
			continue;
		}

		best = sheet;
		bestArea = area;
	}

	if (!best) {
		throw new Error(
			`${sizes.length} images do not fit in ${maxEdge} px; pass fewer.`,
		);
	}

	return best;
}

export function pngSize(bytes: Uint8Array): Size {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) {
		throw new Error('Not a PNG file.');
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return {width: view.getUint32(16), height: view.getUint32(20)};
}

type Shot = {path: string; label: string};

async function collectShots(
	args: string[],
	base: string,
	out: string,
): Promise<Shot[]> {
	const shots: Shot[] = [];
	for (const arg of args) {
		const path = resolve(base, arg);
		if ((await stat(path)).isDirectory()) {
			const names = await readdir(path, {recursive: true});
			for (const name of names.toSorted()) {
				const file = join(path, name);
				if (
					extname(name).toLowerCase() === '.png' &&
					!basename(name).startsWith('proof-sheet') &&
					file !== out
				) {
					shots.push({path: file, label: name.replace(/\.png$/i, '')});
				}
			}
		} else {
			shots.push({path, label: basename(path).replace(/\.png$/i, '')});
		}
	}

	return shots;
}

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('"', '&quot;');
}

function sheetHtml(shots: Shot[], sheet: Sheet): string {
	const figures = shots.map((shot, index) => {
		const {x, y, width, height} = sheet.tiles[index];
		const source = escapeHtml(pathToFileURL(shot.path).href);
		return `<img src="${source}" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px"><p style="left:${x}px;top:${y + height}px;width:${width}px">${escapeHtml(shot.label)}</p>`;
	});
	return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#3b3b3b;width:${sheet.width}px;height:${sheet.height}px;overflow:hidden}
img{position:absolute;outline:1px solid #777}
p{position:absolute;margin:0;height:${LABEL_HEIGHT}px;overflow:hidden;font:12px/15px system-ui,sans-serif;color:#fff;overflow-wrap:anywhere}
</style>${figures.join('')}`;
}

async function main(argv: string[]) {
	const base = process.env.INIT_CWD ?? process.cwd();
	const outIndex = argv.indexOf('--out');
	const inputs = [...argv];
	const [, outArg] = outIndex === -1 ? [] : inputs.splice(outIndex, 2);
	if (inputs.length === 0 || (outIndex !== -1 && !outArg)) {
		throw new Error(usage);
	}

	const out = outArg
		? resolve(base, outArg)
		: fromRoot('.dev/evidence/proof-sheet.png');
	const shots = await collectShots(inputs, base, out);
	if (shots.length === 0) {
		throw new Error(`No PNG files found. ${usage}`);
	}

	const sizes = await Promise.all(
		shots.map(async (shot) => {
			try {
				return pngSize(await readFile(shot.path));
			} catch (error) {
				throw new Error(`${shot.path}: ${(error as Error).message}`, {
					cause: error,
				});
			}
		}),
	);
	const sheet = layoutSheet(sizes);
	const folder = await mkdtemp(join(tmpdir(), 'tablodge-proof-sheet-'));
	const browser = await chromium.launch({headless: true});
	try {
		const page = await browser.newPage({
			viewport: {width: sheet.width, height: sheet.height},
			deviceScaleFactor: 1,
		});
		const html = join(folder, 'sheet.html');
		await writeFile(html, sheetHtml(shots, sheet));
		await page.goto(pathToFileURL(html).href, {waitUntil: 'load'});
		await page.screenshot({path: out});
	} finally {
		await browser.close();
		await rm(folder, {recursive: true, force: true});
	}

	const written = pngSize(await readFile(out));
	console.log(
		`${out} (${written.width}x${written.height}, ${shots.length} screenshots)`,
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	await main(process.argv.slice(2));
}
