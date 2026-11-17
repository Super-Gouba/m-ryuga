# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.7] — 2026-11-17

### Added
- **In-app update** — the update dialog now has a **下载并安装** button: it downloads the matching installer
  (Setup, or Portable for portable builds) with a progress bar, launches it (silent `/S` for Setup) and
  restarts the app, instead of only opening the release page.

### Changed
- Release notes are rendered as formatted text (headings, bullets, bold, inline code); the downloads table
  is hidden because the installer is handled in-app.

### Fixed
- Overview "file size" now shows the real size on disk instead of **0 B**.

## [1.0.6] — 2026-11-17

### Changed
- Ladder participants now show **信令 / 媒体** instead of caller / callee / media: any address that carries SIP
  is signaling, and only RTP-only endpoints are marked as media (fixes B2BUA servers being labeled media).
- DTMF keys moved to a dedicated lane above each waveform, spaced out to avoid overlap, with a leader line
  back to the exact keypress time; waveform height increased to fit.

### Fixed
- Pseudo-gaps caused by RTP timestamp resets (>10 s) are ignored by the stall/longest-gap stats and no
  longer shade the whole waveform.

## [1.0.5] — 2026-11-17

### Added
- DTMF keys are now drawn on the audio waveform: a dashed marker plus a digit chip at the exact keypress
  time (neighbouring keys are staggered, chips clamp inside the plot area).

### Changed
- Absolute timestamps include the date everywhere it matters: call detail header, overview (capture
  start/end, call start), timeline, message list, message metadata and audio header. The call list shows
  `MM-DD HH:MM:SS` to stay compact.

### Fixed
- Gap durations produced by RTP timestamp resets are clamped to the audio length, so "longest gap"
  statistics and waveform shading no longer show multi-day values.

## [1.0.4] — 2026-11-17

### Added
- **Text SIP log analysis** — import `.txt` / `.log` call-flow exports (VOS `CALLFLOW|…` traces and plain SIP
  text) alongside captures: timestamps, endpoints and Call-IDs are reconstructed, then the ladder,
  message list, overview and HTML report work as usual. Text logs carry signaling only, so PCAPNG/WAV
  export is disabled and media diagnostics are skipped.
- **Audio analysis** (formerly "Audio") — summary statistics (duration, packets/loss, jitter, stalls
  ≥200 ms, longest gap), per-direction tracks with seek/solo/mute, and a waveform with time axis,
  amplitude envelope, silence bands, loss/gap markers and a playhead.
- `npm test` now covers the text-log parser (26 assertions).

### Changed
- Call overview uses an aligned two-column grid: capture file / current call, protocol mix, timeline /
  media, then a full-width diagnosis card.

### Fixed
- SIP text logs that omit the blank line before SDP now parse their body and negotiated codecs.
- Command-line / open-file import accepts `.txt` / `.log`.

## [1.0.3] — 2026-11-16

### Added
- Message detail fields are click-to-copy with inline confirmation; values now wrap instead of being
  truncated with an ellipsis, so long URIs and Call-IDs stay fully readable.
- Chinese labels for detail fields (时间 / 源地址 / 目的地址 / 主叫 / 被叫 / 用户代理), while CSeq and
  Call-ID keep their protocol names.

### Changed
- Simplified **DETAILS** in the message modal: dropped `TYPE` and `TRANSPORT`, show `STATUS` and
  `METHOD` only for responses.
- Settings entry moved to the bottom-left corner of the status bar with a larger icon and label.
- Settings page spacing, navigation width and typography refined.
- Simplified Chinese is now the default interface language.

### Removed
- Old release artifacts are cleaned from `release/` when a new version is built.

## [1.0.2] — 2026-11-16

### Added
- Settings entry in the bottom-right status bar, with an active state and a back button on the settings page.
- Open-source row in **About M-Ryuga** with GitHub and MIT license links.

### Changed
- Message rendering now uses a high-contrast palette: methods and URIs, header names, URIs/agents/numeric
  values and SDP lines are colored separately, matching the readability of Homer's signaling view.
- `Software update` moved from its own settings page into the bottom of **About M-Ryuga**.
- Settings navigation no longer occupies a top-level tab.

## [1.0.1] — 2026-11-16

### Added
- **Expanded message view** — the message pane now has an expand button that opens a Homer-style card:
  header with message type, a `DETAILS` metadata grid (method, status, time, endpoints, CSeq, Call-ID,
  From/To, User-Agent, transport) and a syntax-highlighted `PAYLOAD` panel.
  Supports maximize/restore, word-wrap toggle, copy raw message and `Esc` to close.
- `docs/RELEASE.md` — release SOP covering versioning, verification, packaging, publishing and
  update-path validation.

### Changed
- Message detail pane moved to a consistent header with the expand action for SIP messages,
  DTMF events and RTP streams.

## [1.0.0] — 2026-11-16

### Added
- SIP / RTP capture analysis with multi-file import (dialog, drag-and-drop, executable drop).
- Ladder diagram with SIP messages, DTMF events and RTP media spans; click an RTP row to solo that direction.
- Call overview: capture basics, protocol mix, call summary, DTMF sequence, diagnosis and media statistics.
- Media reconstruction with per-direction waveforms, playback, seek, playback rate and zoom.
- Three-channel DTMF detection: RFC 2833/4733, SIP INFO and in-band audio.
- Call diagnostics: timeline, termination cause (Q.850), signaling and media issue classification.
- Live capture via npcap/dumpcap: multi-interface, BPF filters, split/ring modes, real-time call view,
  and an explicit save-or-discard decision after stopping.
- Offline transcription via optional whisper.cpp engine and GGML models, with guided setup.
- Export: associated PCAPNG slice, per-direction WAV, self-contained HTML report, privacy masking.
- Bilingual interface (English default, Simplified Chinese), runtime switch.
- In-app update check against GitHub Releases, resumable pane widths, zoom shortcuts.

### Fixed
- Multi-file import collapsing into a single entry (file identifier collision).
- Drag-and-drop yielding no files on Electron 32+ (`File.path` removal).
- Crash on malformed SIP messages lacking `Call-ID`.
- Missing status reason phrase producing garbled labels.
- DTMF keys visible only in diagnosis but absent from ladder and message list.
- No audio in dual-channel playback for captures without SDP (direction slot collision).
- Layout imbalance on very wide displays and lack of stacking on narrow windows.

[1.0.7]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.7
[1.0.6]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.6
[1.0.5]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.5
[1.0.4]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.4
[1.0.3]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.3
[1.0.2]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.2
[1.0.1]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.1
[1.0.0]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.0
