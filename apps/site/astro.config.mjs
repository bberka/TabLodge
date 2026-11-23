import sitemap from '@astrojs/sitemap';
import {defineConfig} from 'astro/config';

export default defineConfig({
	site: 'https://tablodge.bbay.dev',
	output: 'static',
	trailingSlash: 'always',
	build: {format: 'directory', inlineStylesheets: 'always'},
	integrations: [sitemap()],
	devToolbar: {enabled: false},
});
