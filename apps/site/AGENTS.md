# Website

Load [site.md](../../docs/agents/site.md) before editing here.

- Screenshots use the synthetic data from `vp run dev:chrome --seed-data`, never a personal browser profile.
- Add a download platform in `src/lib/downloads.ts`, `ButtonIcon.astro`, and `platform.ts`. Never hand write a download button.
- The site ships no JavaScript to the browser. Check privacy claims against [PRIVACY.md](../../docs/PRIVACY.md) and competitor claims against their own documentation.
