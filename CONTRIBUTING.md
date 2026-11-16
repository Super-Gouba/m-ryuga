# Contributing to M-Ryuga

Thanks for taking the time to contribute.

## Before you start

- Search existing [issues](https://github.com/Super-Gouba/m-ryuga/issues) and pull requests first.
- For large features, open an issue to agree on the approach before writing code.
- Never attach real customer captures. Sanitize numbers, IPs and SIP credentials
  (the **Export → Privacy masking** option helps), or generate a synthetic capture.

## Development

```bash
npm install
npm run dev        # Vite dev server + Electron with hot reload
npm test           # core parser self-tests (must stay green)
npm run smoke:ui   # headless smoke test against the packaged app
```

Project layout:

| Path | Responsibility |
| --- | --- |
| `src/core` | Pure Node.js: capture readers, SIP/RTP parsers, media decoders, analyzer, exporters. No Electron imports. |
| `src/main` | Electron main process: window, tray, IPC, live capture, updater. |
| `src/preload` | `contextBridge` surface. Keep it explicit and minimal. |
| `src/renderer` | React UI: pages, design tokens, i18n dictionaries. |

## Pull requests

1. Fork, create a topic branch, and keep commits focused.
2. Add or update tests when touching `src/core`.
3. Run `npm test` and `npm run build` before opening the PR.
4. Describe **why** the change is needed, not only what changed. Include a capture sample or
   reproduction steps for bug fixes.
5. UI changes: include a screenshot at 1440×900 and mention the narrow-window behaviour.

## Code style

- Plain JavaScript (CommonJS in `src/core` and `src/main`, ESM in `src/renderer`).
- No new runtime dependencies without discussion — the app must stay offline-capable and small.
- UI strings must be added to both `en` and `zh` dictionaries in `src/renderer/i18n.js`.

## Commit messages

Conventional prefixes are appreciated: `feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, `test:`, `chore:`.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
