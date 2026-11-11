// Bundles the Docker server into one file, dist/node.js, so the image needs no node_modules.
import {defineConfig} from 'vite-plus';

export default defineConfig({
	build: {
		ssr: 'src/node.ts',
		outDir: 'dist',
		target: 'node24',
		emptyOutDir: true,
		rollupOptions: {output: {entryFileNames: 'node.js'}},
	},
	ssr: {noExternal: true},
});
