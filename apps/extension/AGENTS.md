# Extension

Load [extension.md](../../docs/agents/extension.md) before editing here, and [ui.md](../../docs/agents/ui.md) for UI.

- `src/shared/` also compiled into server and Android app. Keep free of browser and Node APIs, run `vp run check` after changing. Server and app break on browser API there.
- Change to storage key, export format identifier, drag MIME type, or context menu ID needs migration. Stored libraries and older exports still use old name.
- No CDN, remote font, or network call. Privacy policy promises everything bundled; new permission needs row in [PRIVACY.md](../../docs/PRIVACY.md#permissions).
- Prove behavior in headless dev browser (`vp run dev:chrome --headless`), not from unit tests or green build.
