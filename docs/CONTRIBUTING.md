# Contributing to TabLodge

Bug reports, ideas, and pull requests are welcome. Before a larger change, open an issue first so we can agree on the approach before you spend time on it.

## Get set up

Follow the [source installation steps](README.md#build-from-source) and load `apps/extension/dist/tablodge/` in your browser. Keep using the same build folder: loading it from another path can give the extension a different ID and separate storage. Export your data before moving it.

Install the Vite+ CLI once as described in [README Development](README.md#development), then run `vp run dev:chrome` while you work. It loads the Chromium build, rebuilds when files change, and opens Chrome or Chromium with the extension loaded in a profile for this worktree, separate from your regular browser profile. After each rebuild, reload the extension at `chrome://extensions` and reopen its pages. `vp run dev:firefox` does the same for the Firefox build in its own Firefox profile. Reload the add-on at `about:debugging#/runtime/this-firefox` after a rebuild. `vp run browser:firefox` checks the core workflows in headless Firefox. Test a change on both browsers when it touches anything they treat differently (see [Browser support](architecture.md#browser-support)). Use `vp run <task>` for the other scripts in the [README command list](README.md#development).

`pnpm install` also turns on the Git hooks in `.hooks/`. Before each commit they refuse a commit on `master` or `main`, lint the staged files, and type check. Before each push they run `vp run check`. Fix what they report instead of skipping them (see [Git hooks](agents/workflow.md#git-hooks)).

For code locations and how the pieces fit together, see the [project structure](README.md#project-structure) and [architecture notes](architecture.md).

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

Agents follow [AGENTS.md](../AGENTS.md): a worktree and branch per task, commits that name only the human author, a pull request that names the model, proof for every fix or feature, and no direct pushes to `master`. Install the pinned skills with `vp run skills:install`.

## Releases

Releases are cut from the **Release** workflow and use [ZeroVer](https://0ver.org). See [CI and releases](agents/ci.md).

By contributing, you agree to license your contributions under the [MIT License](../LICENSE).
