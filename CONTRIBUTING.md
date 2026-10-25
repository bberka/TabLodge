# Contributing to TabLodge

Thanks for helping. Bug reports, feature ideas, and pull requests are all welcome. For larger changes, please open an issue first so we can agree on the approach.

## Setup

1. Install Node.js 22.18+ or 24.11+ and enable pnpm with `corepack enable` (the version is pinned in `package.json` `packageManager`).
2. Install dependencies and build:

   ```sh
   pnpm install
   pnpm build
   ```

3. Load `dist/tablodge/` as an unpacked extension (`chrome://extensions` or `brave://extensions` → Developer mode → **Load unpacked**).
4. Run `pnpm dev` while you work. It rebuilds into `dist/tablodge/` on every change; reload the extension (and reopen its pages) to see the changes.

Tip: unpacked extensions get their ID, and therefore their storage, from the folder path. Loading the build from a different folder starts with empty storage, so export your data first.

## Scripts

| Command                         | What it does                                       |
| ------------------------------- | -------------------------------------------------- |
| `pnpm build`                    | Build into `dist/tablodge/` and verify the package |
| `pnpm dev` / `pnpm watch`       | Rebuild on changes                                 |
| `pnpm test` / `pnpm test:watch` | Run the Vitest suites                              |
| `pnpm typecheck`                | `tsc -b` over all projects                         |
| `pnpm lint`                     | XO (ESLint, type-aware TypeScript and React rules) |
| `pnpm lint:fix` / `pnpm format` | Auto-fix and format with XO                        |
| `pnpm check`                    | Lint, typecheck, and tests: must pass before a PR  |
| `pnpm verify`                   | Re-verify an existing build                        |
| `pnpm clean`                    | Remove `dist/` and build caches                    |

## Where things live

- `extension/`: manifest, icons, HTML shells, `service-worker.ts` (all storage and browser-API work), and `theme-boot.ts`.
- `src/app/`: one entry per page (`newtab`, `popup`, `options`, `help`, `sidepanel`) plus shared page code in `common.tsx` and `dashboard.tsx`. `types.ts` defines the data model and the typed messages pages send to the service worker.
- `src/components/ui/`: shadcn-style primitives. `src/shared/`: composed UI helpers and the theme provider.
- `tests/`: Vitest suites. `docs/architecture.md`: build pipeline, storage, naming, and detailed behavior.

## Code style

- **TypeScript strict**, no `any` escapes. Validate anything untrusted (stored data, imports, messages) before use; the service worker treats every input as untrusted.
- **XO style.** Formatting and lint rules come from [XO](https://github.com/xojs/xo) with its defaults (tabs, single quotes, semicolons, Prettier formatting, type-aware TypeScript rules) plus the React rules from `eslint-config-xo-react`. It also lints the HTML shells, CSS, JSON, and Markdown. Run `pnpm lint:fix` before committing; `pnpm check` fails on any XO error. Review what the auto-fixer changed (`pnpm check` re-runs the tests), because a few rule fixes can change behavior.
- **Rule exceptions** live in `xo.config.ts`, each with a one-line reason and scoped with `files` where possible. Avoid inline disable comments; when a single line really needs one, write `// eslint-disable-next-line <rule> -- <reason>`.
- **Tailwind for styling**, using the theme tokens (`bg-background`, `text-muted-foreground`, `border-border`, `text-primary`, …) so light and dark themes work. Avoid raw colors and new global CSS.
- **shadcn-style components.** Build UI from `src/components/ui/` (Radix primitives) via `src/shared/ui.tsx`. To add one, run `pnpm dlx shadcn@latest add <component>` and review the generated file.
- **Icons from `lucide-react`** only.
- **Everything bundled.** Never add CDN imports, remote fonts, or network calls; TabLodge is local-only by design (see [PRIVACY.md](PRIVACY.md)). New permissions need a strong reason and an entry in the README and PRIVACY tables.
- **Accessibility.** Keyboard-operable controls, visible focus rings, labels for icon-only buttons (`aria-label` plus `IconTooltip`), and `role="status"`/`alert` for feedback.
- **User-facing name.** Use `PROJECT.name` (pages) or `APP_NAME` (service worker) instead of writing "TabLodge" in UI strings; both read the manifest `short_name`. Storage keys, export format ids, drag MIME types, and context-menu ids are persistent: changing them needs a migration.
- External links open in a new tab with `target="_blank" rel="noopener noreferrer"`.

## Testing

- Service-worker behavior is tested in `tests/service-worker.test.ts`, which runs the worker source in a Node VM against a mocked `chrome.*` API. Add a test for every bug fix and behavior change there; extend the mock when you use a new API.
- Pure helpers (for example `src/app/interaction-actions.ts`) get direct unit tests.
- Mocks don't catch everything: also try your change in a Chromium-based browser with the unpacked build, in both light and dark themes.

## Releases

Releases use [ZeroVer](https://0ver.org): every version is `0.<minor>.<patch>`.

- The root `VERSION` file holds `<minor>` (a single number such as `1`).
- `<patch>` is computed when a release runs: it continues from the latest `v0.<minor>.*` tag, or starts at `0` when that minor has no release yet. With `VERSION` = `1` and latest release `0.1.1`, the next release is `0.1.2`; change `VERSION` to `2` and it becomes `0.2.0`. `VERSION` can't go below the latest released minor.
- To release, run **Actions → Release → Run workflow** on the default branch (`master`). The workflow computes the version, stamps it into `package.json` and `extension/manifest.json`, runs `pnpm check` and `pnpm build`, zips the unpacked extension, and publishes a `v0.x.y` GitHub release with the zip and its SHA-256 checksum.
- `pnpm version:next` prints the version the next release would get (based on your local tags).

## Pull request checklist

- [ ] `pnpm check` passes (0 errors) and `pnpm build` succeeds with verification.
- [ ] Tests cover the change (or the PR explains why not).
- [ ] Manually tested in a Chromium-based browser with the unpacked `dist/tablodge/` build.
- [ ] UI follows the existing style (tokens, shadcn components, lucide icons) and works in light and dark themes and with the keyboard.
- [ ] No new network requests, CDN assets, or permissions (or they are justified and documented in README and PRIVACY).
- [ ] Stored-data changes stay backward compatible (bump the schema version and normalize older data in the service worker).
- [ ] `README.md`, the landing page in `site/` (copy and screenshots), Help, and `PRIVACY.md` are updated if the change made anything in them outdated.
- [ ] User-visible changes are described in the PR for the release notes.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
