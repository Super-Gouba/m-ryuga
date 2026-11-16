# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting:
<https://github.com/Super-Gouba/m-ryuga/security/advisories/new>

Include:

- affected version (shown in **Settings → About**),
- operating system,
- reproduction steps or a minimal capture that triggers the issue,
- impact assessment (crash, data exposure, arbitrary code execution, …).

We aim to acknowledge reports within 72 hours and to publish a fixed release as soon as practical.

## Scope

M-Ryuga parses untrusted packet captures. Issues in the following areas are in scope:

- memory-safety or denial-of-service problems in the PCAP / SIP / RTP parsers (`src/core`),
- path traversal in import/export or the `app://` protocol handler,
- IPC surface exposure in `src/preload` and `src/main/ipc.js`,
- updater trust issues (release verification, redirects).

## Data handling

The application is local-first: captures, audio and transcripts never leave the machine. The only
outbound request is the optional update check against the GitHub Releases API.
