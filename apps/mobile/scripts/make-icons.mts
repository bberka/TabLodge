import {execFileSync} from 'node:child_process';
import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const mobileDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(mobileDir, 'assets');
const markSvg = readFileSync(
	join(mobileDir, '../extension/shell/icons/tablodge.svg'),
	'utf8',
);
const markPath = /<path d="([^"]+)"/.exec(markSvg)?.[1];
if (!markPath) {
	throw new Error('Could not find the mark path in tablodge.svg.');
}

const size = 1024;
const brand = '#6254D7';
const brightBrand = '#A99FFF';
const lightBackground = '#EFEDFB';

function markCanvas(width: number, color: string, background?: string) {
	const scale = width / 112;
	const fill = background
		? `<rect width="${size}" height="${size}" fill="${background}"/>`
		: '';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${fill}<g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(-64 -64)"><path d="${markPath}" fill="${color}" stroke="${color}" stroke-width="8" stroke-linejoin="round"/></g></svg>`;
}

type ColorType = 'rgb' | 'rgba' | 'gray-alpha';

const pngTypes: Record<ColorType, string[]> = {
	rgb: ['-alpha', 'off', '-define', 'png:color-type=2'],
	rgba: ['-define', 'png:color-type=6'],
	'gray-alpha': ['-colorspace', 'Gray', '-define', 'png:color-type=4'],
};

function render(name: string, svg: string, colorType: ColorType) {
	const svgFile = join(assetsDir, `.${name}.svg`);
	writeFileSync(svgFile, svg);
	const output = join(assetsDir, name);
	try {
		execFileSync('rsvg-convert', [
			'-w',
			`${size}`,
			'-h',
			`${size}`,
			'-o',
			output,
			svgFile,
		]);
	} finally {
		rmSync(svgFile, {force: true});
	}

	execFileSync('magick', [output, ...pngTypes[colorType], '-strip', output]);
}

render('android-icon-foreground.png', markCanvas(526, brand), 'rgba');
render('android-icon-monochrome.png', markCanvas(526, '#000000'), 'gray-alpha');
render('icon.png', markCanvas(526, brand, lightBackground), 'rgb');
render('splash-icon.png', markCanvas(448, brand), 'rgba');
render('splash-icon-dark.png', markCanvas(448, brightBrand), 'rgba');

console.log('Icons written to apps/mobile/assets.');
