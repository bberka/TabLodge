# Contributing to TabLodge

Bug reports, ideas, and pull requests are welcome. Before a larger change, open an issue first so we can agree on the approach before you spend time on it.

## Get set up

Follow the [source installation steps](install.md#build-from-source) and load `apps/extension/dist/tablodge/` in your browser. Keep using the same build folder: loading it from another path can give the extension a different ID and separate storage. Export your data before moving it.

Install the Vite+ CLI once as described in [Development](#development), then run `vp run dev:chrome` while you work. It loads the Chromium build, rebuilds when files change, and opens Chrome or Chromium with the extension loaded in a profile for this worktree, separate from your regular browser profile. After each rebuild, reload the extension at `chrome://extensions` and reopen its pages. `vp run dev:firefox` does the same for the Firefox build in its own Firefox profile. Reload the add-on at `about:debugging#/runtime/this-firefox` after a rebuild. `vp run check:firefox` checks the core workflows in headless Firefox. Test a change on both browsers when it touches anything they treat differently (see [Browser support](architecture.md#browser-support)). Use `vp run <task>` for the other scripts in the [command list](#development).

`pnpm install` also turns on the Git hooks in `.hooks/`. Before each commit they refuse a commit on `master` or `main`, lint the staged files, and type check. Before each push they run `vp run check`. Fix what they report instead of skipping them (see [Git hooks](agents/workflow.md#git-hooks)).

For code locations and how the pieces fit together, see the [project structure](#project-structure) and [architecture notes](architecture.md).

## Development

Install the [Vite+ CLI](https://viteplus.dev/) once, run `pnpm install`, then use `vp run <task>` from the repository root.

| Command | What it does |
| --- | --- |
| `vp run dev:chrome` | Build, watch, and open a test browser with TabLodge loaded. `--seed-data` adds sample data and `--headless` opens no window |
| `vp run dev:firefox` | The same in Firefox |
| `vp run check` | Lint, type checks, and tests |
| `vp run check:a11y` | Accessibility and keyboard checks on the built extension. The other `check:` tasks (`build`, `startup`, `firefox`, `dev-browser`, `private-storage`) each test one part of the built extension |
| `vp run build` / `vp run pack` | Build and verify both browsers, then package them |
| `vp run lint:fix` | Fix lint issues and format with XO |
| `pnpm run mobile:start` | Start Metro for the Android app in `apps/mobile/` (needs a development build; see [Android app](android.md)) |
| `pnpm run mobile:apk` | Build a standalone Android APK from this checkout into `apps/mobile/dist/tablodge-local.apk`; add `--install` to install it with adb, or `--all-abis` to include 32 bit ARM |
| `pnpm run mobile:icons` | Redraw the Android app's launcher and splash images from the extension's mark (needs `rsvg-convert` and ImageMagick) |
| `pnpm run mobile:licences` | Write the Android app's Open source licences list from the bundle and, after prebuild, the release classpath |
| `pnpm run mobile:export` | Write the licences list, then bundle the Android app's JavaScript to check that it builds |
| `pnpm run cf:setup` | Deploy the sync server to Cloudflare (see [Self hosting](self-hosting.md)) |
| `pnpm run cf:bundle` | Rebuild `apps/server/cloudflare-deploy/worker.js` after changing the server or the sync code |

The test browser keeps its own profile in `apps/extension/.dev/`, apart from your regular one. After a rebuild, reload TabLodge on the extensions page. Headless runs (`dev:chrome --headless`, `dev:firefox --headless`) are for automated checks; see [Browser access](agents/extension.md#browser-access).

## Project structure

```text
apps/extension/   The browser extension (Chrome, Brave, Firefox)
  shell/            Manifest, icons, HTML shells, service worker
  src/app/          Extension pages, data types, and messages
  src/shared/       Shared helpers, library storage, and the sync protocol (src/shared/sync/), also used by the server and the Android app
  src/components/ui/  UI primitives (Radix and Tailwind)
  styles/           Tailwind stylesheet for the extension pages
  scripts/          Build, packaging, dev browser, and accessibility tooling
  tests/            Vitest suites with mocked browser APIs
apps/server/      Self hosted sync server for Docker and Cloudflare (cloudflare-deploy/ is what the Deploy to Cloudflare button copies)
apps/mobile/      Android app (Expo and React Native), in progress
apps/site/        Website for tablodge.bbay.dev (vp run site:dev)
scripts/          Repository wide tooling (release versioning)
tsconfig/         TypeScript settings shared by every app
docs/             All documentation except AGENTS.md
.hooks/           Git hooks that run the checks before commits and pushes
```

## Conventions

The rules for each part of the repository live next to the work, in [docs/agents/](agents/). People and agents follow the same files:

- Extension code: [Extension](agents/extension.md). UI and accessibility: [UI rules](agents/ui.md).
- Android app: [Mobile](agents/mobile.md). Sync server: [Server](agents/server.md). Website: [Site](agents/site.md).
- Changes that reach more than one app: [Cross app work](agents/cross-app.md).
- Docs, Help, and website copy: [Documentation](agents/documentation.md).
- Linting and formatting use XO only: `vp run lint:fix`, or `pnpm exec xo --fix <files>`. Keep rule exceptions in `xo.config.ts` with a short reason and a narrow scope.

## Test your change

Each app keeps its tests in `apps/<app>/tests/` (release tooling in `scripts/`), and `vp run test` runs every suite. Add a regression test for a bug fix and cover new behavior at the most direct existing boundary. Mocks cannot catch everything, so for runtime changes load the build in the dev browser and exercise the workflow ([Validation](agents/validation.md)). Before opening a pull request run:

```sh
vp run check
vp run build
```

In the pull request, explain what changed, why, and how you tested it. Mention checks you could not run. Call out new permissions and storage changes, including how older data is handled, and describe changes people will notice so they reach the release notes.

## Working with AI agents

Agents follow [AGENTS.md](../AGENTS.md): a worktree and branch per task, commits that name only the human author, a pull request that names the model, proof for every fix or feature, and no direct pushes to `master`. Features start from a spec on the issue and pull requests report proof for each of its acceptance criteria ([Spec driven development](agents/spec-driven.md)). Install the pinned skills with `vp run skills:install`.

## Releases

Releases are cut from the **Release** workflow and use [ZeroVer](https://0ver.org). See [CI and releases](agents/ci.md).

By contributing, you agree to license your contributions under the [MIT License](../LICENSE).
