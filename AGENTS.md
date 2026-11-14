# TabLodge

A local first tab session and bookmark manager. A pnpm workspace of four apps that share one library format and sync protocol. Humans start at [docs/README.md](docs/README.md); everything agents need is in [docs/agents/](docs/agents/), loaded on demand below.

## Layout

- `apps/extension`: Chrome, Brave, and Firefox extension. Its `src/shared` and `src/app/types.ts` are also imported by the server and the Android app
- `apps/server`: Self hosted sync server (Docker or Cloudflare)
- `apps/mobile`: Android app (Expo, React Native)
- `apps/site`: Website, tablodge.bbay.dev (Astro)
- `scripts/`, `tsconfig/`: Repository wide tooling and shared TypeScript settings
- `docs/`: All Markdown except this file. `docs/agents/` is for you

Run tasks as `vp run <task>` from the root; scripts in the root `package.json` forward to the right app.

## Hard rules

- Never commit on or push to `master` or `main`; work on a `<type>/<short-topic>` branch and open a pull request.
- Commits name the human author only. The pull request names the model.
- Every fix or feature carries proof in the pull request.
- Run the `unslop-*` skills on the diff before every push.
- Leave the Git hooks on, and finish the gate before pushing.
- A change is not done while a document still describes the old behavior.

## Load on demand

- Committing, pushing, opening or watching a pull request, hooks → [workflow.md](docs/agents/workflow.md)
- Reporting work complete, proof, checks, unslop → [validation.md](docs/agents/validation.md)
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
