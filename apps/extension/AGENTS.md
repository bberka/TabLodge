# Extension

Load [extension.md](../../docs/agents/extension.md) before editing here, and [ui.md](../../docs/agents/ui.md) for UI.

- `src/shared/` is also compiled into the server and the Android app. Keep it free of browser and Node APIs, and run `vp run check` after changing it. The server and the app break on a browser API there.
- A change to a storage key, export format identifier, drag MIME type, or context menu ID needs a migration. Stored libraries and older exports still use the old name.
- No CDN, remote font, or network call. The privacy policy promises everything is bundled; a new permission needs a row in [PRIVACY.md](../../docs/PRIVACY.md#permissions).
- Prove behavior in the headless dev browser (`vp run dev:chrome --headless`), not from unit tests or a green build.
