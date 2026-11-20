# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.16] — 2026-11-20

### Fixed
- **Keyboard accessibility gaps** — message-table rows, ladder (sequence-diagram) rows, the update-log
  version list and message-detail field cells were mouse-only. They now take focus (`Tab`) and respond to
  `Enter` / `Space`.
- **Audio waveform could not be reached by keyboard** — the waveform is now a slider (`role="slider"` with
  `aria-valuenow`); `←`/`→` seek ±5 s, `Shift` + arrow seeks ±30 s, `Home` / `End` jump to the start / end.
- **Dialogs trapped focus outside** — the message-detail and close-confirmation dialogs now move focus into
  the dialog on open and keep `Esc` as cancel.
- **Focus ring missing on custom controls** — focus outlines now also cover the canvas slider and focusable
  table rows.

### Changed
- **English UI cleanup** — a few remaining hard-coded Chinese strings in the message table, ladder and
  transcript panel now go through the i18n layer.
- Toast notifications expose `role="status"` / `aria-live` so screen readers announce import results and errors.

## [1.0.15] — 2026-11-19

### Fixed
- **"Quit" choice was not remembered** — the remembered close action lived only in main-process memory,
  so choosing "Quit M-Ryuga" + "Remember my choice" still prompted on the next launch, while
  "Keep running in the tray" appeared to work. The choice is now written to `ui-state.json` and
  restored at startup.
- Closing behavior can be changed again from **Settings → Closing behavior** (Ask every time / Tray /
  Quit), so a remembered choice no longer becomes irreversible.

## [1.0.14] — 2026-11-18

### Fixed
- **Large-capture freeze** — an 18 MB capture with 4,500 calls used to mount every call row at once.
  The call list is now windowed (visible rows plus an 8-row overscan), keeping the DOM at ~15 rows
  regardless of capture size; scrolling still covers the full list.

### Changed
- **Transcript merged into Audio analysis** — the separate 转写 tab is gone. Transcription mode, start /
  restart, progress and searchable results now sit below the audio player in the same tab, so playback and
  transcription are controlled in one place. Running jobs still survive tab and page switches.
- **Message table no longer wraps** — the time, signaling and source→destination columns stay on one line;
  when the pane is narrow the table scrolls horizontally instead of squeezing text.
- **Lighter import payload** — per-call diagnostics are no longer sent for every call during import
  (fetched on demand when a call is opened), and the full result is no longer duplicated through the
  `task:done` event.

## [1.0.13] — 2026-11-18

### Fixed
- **Close dialog persisted after tray restore** — confirming "keep running in the tray" now clears the dialog
  state before the window hides, so the app returns to its normal page when reopened from the tray.

### Changed
- **SIP-aware ladder annotations** — mid-call INVITEs are now recognised as **re-INVITE / session update**
  (To-tag or existing dialog), a 2xx to a re-INVITE reads "session update accepted", and its ACK reads
  "session update confirmed". SDP `sendonly` / `recvonly` / `inactive` offers are labelled as hold, and
  `sendrecv` after a hold as resume.
- **Retransmission labels** — identical requests / responses within 64×T1 (32 s) are marked as
  retransmissions instead of repeating the original explanation.
- **More precise response reasons** — 401/407 authentication, 403/603 rejected, 404 not found, 408 timeout,
  480 unavailable, 486 busy, 487 cancelled, 488/606 media negotiation failure, 503 unavailable; PRACK,
  UPDATE, INFO, OPTIONS, MESSAGE and SUBSCRIBE/NOTIFY are also annotated.
- The call-flow strip now includes re-INVITE steps and detects the release time from the BYE response when
  the BYE request itself was not captured.

## [1.0.12] — 2026-11-17

### Added
- **Ladder annotations** — a call-flow strip above the ladder summarises the call
  (setup → ringing → answered → talk time → release), and every SIP message now carries a
  plain-language annotation under its label (e.g. "answered, media ready"), with CSeq kept inline.

### Changed
- **Close dialog redesign** — "keep running in the tray" and "quit" are now selectable option cards with
  icon, description and radio state, followed by a Cancel / Confirm footer; fully localized.

## [1.0.11] — 2026-11-17

### Added
- **Download audio** — the Audio analysis transport bar now has a download button with a target selector
  (mixed A+B / caller A / callee B). The main process re-decodes the chosen stream and opens a save
  dialog, defaulting to `Downloads\M-Ryuga-<call>-<target>.wav`.
- **Version history** — Settings → About → Software update has a **Changelog** button that lists every
  GitHub release; selecting a version renders its notes in the current interface language.

### Changed
- Update notes are no longer bilingual in one pane: release bodies are split on the `---` separator and
  only the section matching the current language (Chinese or English) is rendered.

## [1.0.10] — 2026-11-17

### Added
- **Transcript tab in call analysis** — 通话分析 now has a 转写 tab: pick merge / per-direction mode, start
  transcription, watch progress and elapsed time, and read searchable segments with channel badges.
- Transcription settings live on the 语音转写 page: recognition language (中文 / 自动 / English), default mode,
  model recommendations and engine setup.

### Fixed
- **Merge mode only transcribed one direction** — both RTP directions are now mixed into one WAV (with
  clipping protection) instead of falling back to the caller stream.

### Changed
- Transcription tasks are kept in a module-level session, so switching pages or tabs no longer cancels or
  hides the running job or its result.
- whisper.cpp is started with CPU thread count and segment timestamps are parsed for real progress; the UI
  also shows elapsed time and explains that `medium` is slow on CPU.

## [1.0.9] — 2026-11-17

### Added
- **One-click ASR engine** — 语音转写 now downloads the official whisper.cpp Windows build (`b5454`,
  `whisper-bin-x64.zip`, ~8.5 MB), extracts `whisper-cli.exe` and its DLLs into `models\bin`, and retries once
  on network timeout. A manual "选择程序文件" picker and `whisper-standalone.exe` detection are also supported.

### Changed
- Audio waveform visuals: soft gradient panel instead of flat white, mirrored envelope fill with a smooth
  contour, thin silence markers along the centre line, subtler grid and a taller DTMF lane.

### Fixed
- The old "下载 whisper.cpp" link pointed at a release that only ships source code; the engine is now pinned
  to a build tag that actually contains Windows binaries.

## [1.0.8] — 2026-11-17

### Fixed
- Silent upgrade now waits for the NSIS installer to finish, then relaunches the app automatically
  (`app.relaunch`), instead of quitting before installation completes.
- Downloaded installers have their Mark-of-the-Web removed, so the silent `/S` install is not blocked by
  SmartScreen.
- Installer failures (non-zero exit code or timeout) are reported in the dialog instead of leaving the app
  closed.

### Notes
- Builds **before 1.0.7** do not contain the in-app downloader — upgrading from 1.0.5 or earlier requires
  one manual download of the current installer. From 1.0.7 onward the one-click update applies.

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

[1.0.14]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.14
[1.0.13]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.13
[1.0.12]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.12
[1.0.11]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.11
[1.0.10]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.10
[1.0.9]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.9
[1.0.8]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.8
[1.0.7]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.7
[1.0.6]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.6
[1.0.5]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.5
[1.0.4]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.4
[1.0.3]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.3
[1.0.2]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.2
[1.0.1]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.1
[1.0.0]: https://github.com/Super-Gouba/m-ryuga/releases/tag/v1.0.0
