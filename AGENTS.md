# TabLodge

Local first tab session + bookmark manager: four apps in pnpm workspace sharing one library format and sync protocol. Humans start at [docs/README.md](docs/README.md); agents load [docs/agents/](docs/agents/) on demand below.

## Layout

- `apps/extension`: Chrome, Brave, Firefox extension. Its `src/shared` and `src/shared/types.ts` also imported by server and Android app
- `apps/server`: Self hosted sync server (Docker or Cloudflare)
- `apps/mobile`: Android app (Expo, React Native)
- `apps/site`: Website, tablodge.bbay.dev (Astro)
- `scripts/`, `tsconfig/`: Repo tooling and shared TypeScript settings
- `docs/`: All Markdown except `AGENTS.md` files. `docs/agents/` is for you; each app also has short `AGENTS.md` that loads when you work in it

Run tasks as `vp run <task>` from root; scripts in root `package.json` forward to right app.

## Hard rules

- Never commit on or push to `master` or `main`; work on `<type>/<short-topic>` branch, open pull request.
- Commits name human author only. Pull request names model.
- Check and claim before coding: read issue's comments, search pull requests for its number, then comment that you are taking it. Release claim if you stop.
- Work from spec: feature has issue with acceptance criteria before first edit, fix has its bug report. Challenge new feature with `challenge-feature` first, unless told to implement it.
- Every fix or feature carries proof in pull request, one piece per acceptance criterion. Ask user only when no proof possible.
- Report only what you ran. Say what you could not run or check; never infer result.
- Change user can see, including follow up request, gets fresh screenshots (dev browser for extension and site, emulator for app) uploaded with `vp run evidence <pr> <files>` into pull request. Local file paths are not proof.
- Guard (hook, lint rule, check, skipped test) says what it prevents, in its doc or config entry. Lint or type directive carries its reason inside it (`eslint-disable-next-line rule -- reason`, `@ts-expect-error reason`). Read reason before changing guard.
- Write no code comments; reason goes in name, type, test, or ADR.
- Never ask whether to run app, take screenshots, or open pull request. Do them, then report.
- Finish task: commit, push, open pull request, wait for green CI, stop every process you started, then say done. Load [workflow.md](docs/agents/workflow.md) and [validation.md](docs/agents/validation.md) before first edit.
- Before every push, run `unslop-*` skills on diff and finish gate. Leave Git hooks on.
- Change not done while document still describes old behavior.

## Load on demand

- Committing, pushing, opening or watching pull request, hooks → [workflow.md](docs/agents/workflow.md)
- Reporting work complete, proof, checks, unslop → [validation.md](docs/agents/validation.md)
- Spec, acceptance criteria, new feature or fix, follow up request → [spec-driven.md](docs/agents/spec-driven.md)
- Extension code (`apps/extension`) → [extension.md](docs/agents/extension.md), then section of [architecture](docs/architecture.md) you touch
- UI, styling, accessibility → [ui.md](docs/agents/ui.md)
- Android app (`apps/mobile`) → [mobile.md](docs/agents/mobile.md)
- Sync server (`apps/server`) → [server.md](docs/agents/server.md)
- Website (`apps/site`), its screenshots → [site.md](docs/agents/site.md)
- Shared code, protocol, data model, new feature, or feature another app could want → [cross-app.md](docs/agents/cross-app.md)
- Code comments, directives, comment ratchet, deleting area's comments → [comments.md](docs/agents/comments.md)
- Workflows, releases, store publishing, Docker image → [ci.md](docs/agents/ci.md)
- Editing docs, Help, or site copy; editing this file → [documentation.md](docs/agents/documentation.md)
- Issues, labels, triage → [issue-tracker.md](docs/agents/issue-tracker.md)
- Permissions, stored data, network behavior → [PRIVACY.md](docs/PRIVACY.md)
- Self hosting behavior or sync API → [self-hosting.md](docs/self-hosting.md)
- Past design decision → [docs/adr/](docs/adr/)
