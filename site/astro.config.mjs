import sitemap from '@astrojs/sitemap';
import {defineConfig} from 'astro/config';

// Static site for https://tablodge.bbay.dev (GitHub Pages, custom domain via public/CNAME).
export default defineConfig({
	site: 'https://tablodge.bbay.dev',
	output: 'static',
	trailingSlash: 'always',
	build: {format: 'directory', inlineStylesheets: 'always'},
	integrations: [sitemap()],
	devToolbar: {enabled: false},
});
