# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.0
