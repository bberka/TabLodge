module.exports = {
	plugins: {
		// Scan this package only; without `base`, Tailwind reads from the directory the build was started in.
		'@tailwindcss/postcss': {base: __dirname},
	},
};
