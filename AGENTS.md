# TabLodge

A local first tab session and bookmark manager: four apps in a pnpm workspace sharing one library format and sync protocol. Humans start at [docs/README.md](docs/README.md); agents load [docs/agents/](docs/agents/) on demand below.

## Layout

- `apps/extension`: Chrome, Brave, and Firefox extension. Its `src/shared` and `src/shared/types.ts` are also imported by the server and the Android app
- `apps/server`: Self hosted sync server (Docker or Cloudflare)
- `apps/mobile`: Android app (Expo, React Native)
- `apps/site`: Website, tablodge.bbay.dev (Astro)
- `scripts/`, `tsconfig/`: Repository tooling and shared TypeScript settings
- `docs/`: All Markdown except the `AGENTS.md` files. `docs/agents/` is for you; each app also has a short `AGENTS.md` that loads when you work in it

Run tasks as `vp run <task>` from the root; scripts in the root `package.json` forward to the right app.

## Hard rules

- Never commit on or push to `master` or `main`; work on a `<type>/<short-topic>` branch and open a pull request.
- Commits name the human author only. The pull request names the model.
- Check and claim before coding: read the issue's comments, search pull requests for its number, then comment that you are taking it. Release the claim if you stop.
- Work from a spec: a feature has an issue with acceptance criteria before the first edit, a fix has its bug report. Challenge a new feature with `challenge-feature` first, unless told to implement it.
- Every fix or feature carries proof in the pull request, one piece per acceptance criterion. Ask the user only when no proof is possible.
- Report only what you ran. Say what you could not run or check; never infer a result.
- A change the user can see, including a follow up request, gets fresh screenshots (dev browser for the extension and site, emulator for the app) uploaded with `vp run evidence <pr> <files>` into the pull request. Local file paths are not proof.
- A guard (hook, lint rule, check, skipped test, `eslint-disable`) says what it prevents. Read that before changing it, and write it when you add one.
- Never ask whether to run the app, take screenshots, or open the pull request. Do them, then report.
- Finish the task: commit, push, open the pull request, wait for green CI, stop every process you started, then say done. Load [workflow.md](docs/agents/workflow.md) and [validation.md](docs/agents/validation.md) before the first edit.
- Before every push, run the `unslop-*` skills on the diff and finish the gate. Leave the Git hooks on.
- A change is not done while a document still describes the old behavior.

## Load on demand

- Committing, pushing, opening or watching a pull request, hooks → [workflow.md](docs/agents/workflow.md)
- Reporting work complete, proof, checks, unslop → [validation.md](docs/agents/validation.md)
- Spec, acceptance criteria, a new feature or fix, a follow up request → [spec-driven.md](docs/agents/spec-driven.md)
- Extension code (`apps/extension`) → [extension.md](docs/agents/extension.md), then the section of [architecture](docs/architecture.md) you touch
- UI, styling, accessibility → [ui.md](docs/agents/ui.md)
- Android app (`apps/mobile`) → [mobile.md](docs/agents/mobile.md)
- Sync server (`apps/server`) → [server.md](docs/agents/server.md)
- Website (`apps/site`), its screenshots → [site.md](docs/agents/site.md)
- Shared code, protocol, data model, new feature, or a feature another app could want → [cross-app.md](docs/agents/cross-app.md)
- Workflows, releases, store publishing, Docker image → [ci.md](docs/agents/ci.md)
- Editing docs, Help, or site copy; editing this file → [documentation.md](docs/agents/documentation.md)
- Issues, labels, triage → [issue-tracker.md](docs/agents/issue-tracker.md)
- Permissions, stored data, network behavior → [PRIVACY.md](docs/PRIVACY.md)
- Self hosting behavior or the sync API → [self-hosting.md](docs/self-hosting.md)
- A past design decision → [docs/adr/](docs/adr/)
