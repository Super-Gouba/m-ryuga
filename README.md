# M-Ryuga

**A local-first VoIP capture workstation for SIP / RTP forensics and call-quality diagnostics.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4)](https://github.com/Super-Gouba/m-ryuga/releases)
[![Electron](https://img.shields.io/badge/Electron-33-47848F)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**English** · [简体中文](README.zh-CN.md)

M-Ryuga opens a `pcap`/`pcapng` file and turns raw packets into an answerable call: who called whom,
how the call was negotiated, when media started, which DTMF digits were pressed, why it failed, and
what the audio actually sounded like — without uploading anything.

Everything runs on your machine. No accounts, no telemetry, no cloud processing.

---

## Features

| Area | What you get |
| --- | --- |
| **Capture support** | PCAP / PCAPNG / CAP, multi-file import (dialog, drag-and-drop, or drop onto the executable), files up to 1 GiB |
| **SIP analysis** | Request/response correlation by `Call-ID`, ladder diagram, raw message view with syntax highlighting, search & filters |
| **Media analysis** | RTP stream reconstruction, per-direction PCM/WAV extraction, waveforms, packet loss, jitter, out-of-order and duplicate counters |
| **DTMF detection** | Three independent channels — RFC 2833/4733, SIP `INFO`, and in-band audio detection — merged and de-duplicated |
| **Call overview** | Capture basics, protocol mix, call summary, DTMF key sequence, diagnosis and media statistics in one tab |
| **Live capture** | npcap/dumpcap integration, multi-interface, BPF filters, ring/split modes, real-time call view, **save-or-discard on stop** |
| **Transcripts** | Optional offline transcription through [whisper.cpp](https://github.com/ggerganov/whisper.cpp) with GGML models |
| **Export** | Associated packets (PCAPNG), per-direction WAV, self-contained HTML report, privacy masking for numbers and IPs |
| **Bilingual UI** | English (default) and Simplified Chinese, switchable at runtime |
| **Workflow** | In-app update check against GitHub Releases, resizable panes, zoom controls, light professional theme |

## Screenshots

> Place sanitized reference captures in `docs/screenshots/` to help us publish screenshots.

## Install

Download the latest build from [**Releases**](https://github.com/Super-Gouba/m-ryuga/releases/latest):

| Build | File | Notes |
| --- | --- | --- |
| Installer | `M-Ryuga-Setup-<version>.exe` | Per-user install, desktop & start-menu shortcuts, uninstaller |
| Portable | `M-Ryuga-Portable-<version>.exe` | Single file, no installation, keeps data in `%APPDATA%\M-Ryuga` |

Windows 10/11 x64. Live capture additionally requires [npcap](https://npcap.com/) and `dumpcap.exe`
(shipped with Wireshark); the app detects both and links to the download pages.

## Quick start

1. Launch M-Ryuga and drop a `pcap` file anywhere in the window.
2. Pick a call in the left list — the ladder diagram opens automatically.
3. Click a SIP row to read the original message; click an **RTP** row to jump to audio and solo that direction.
4. Open **Call overview** for capture basics, DTMF key sequence, diagnosis and media summary.
5. Use **Export** to produce a PCAPNG slice, WAV files or a shareable HTML report.

## Privacy

* All parsing, decoding and diagnostics run locally.
* Audio is never uploaded; transcription runs on your machine through a local binary and model.
* Only the update check performs a network request (GitHub Releases API), and it can be disabled in Settings.

## Build from source

Requirements: Node.js 20+, npm 10+, Windows.

```bash
npm install
npm run dev          # Vite dev server + Electron
npm run build:ui     # renderer bundle
npm run dist         # NSIS installer + portable build (release/)
npm test             # core parser self-tests
npm run smoke:ui     # headless CDP smoke test against the packaged app
```

The renderer is React + Vite; the main process is plain Electron with `contextIsolation` and a
minimal preload bridge. Parsing, media assembly and diagnostics live in `src/core` and have no
Electron dependency, so they can be reused or tested standalone.

```
src/
  core/            # pcap reader, SIP/RTP parsers, media decoders, call analyzer, exporters
  main/            # Electron main process: window, tray, IPC, live capture, updater
  preload/         # contextBridge API surface
  renderer/        # React UI (pages, components, design tokens, i18n)
scripts/           # icon generation, self-tests, CDP smoke test
```

## Contributing

Bug reports and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.
Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 M-Ryuga contributors
