# Release SOP

Standard operating procedure for shipping a M-Ryuga release.
每个版本的发布都按此流程执行，保证版本、变更记录、二进制与更新检测一致。

## 1. Prepare the version

1. Decide the next version per [Semantic Versioning](https://semver.org/): patch for fixes, minor for features, major for breaking changes.
2. Bump `version` in `package.json`.
3. Add a matching entry at the top of `CHANGELOG.md` (`## [x.y.z] — YYYY-MM-DD`) with an `Added / Changed / Fixed` breakdown.
4. Update the in-app changelog if the release introduces user-visible behaviour changes.

## 2. Verify

```bash
npm ci
npm test            # core parser self-tests must be green
npm run build:ui    # renderer bundle builds without warnings
npm run smoke:ui    # packaged app mounts the UI (React root + navigation)
```

Manual checklist before packaging:

- [ ] Import a real capture: call list, ladder, RTP rows, DTMF rows
- [ ] Overview shows packet basics, DTMF sequence, diagnosis, media stats
- [ ] Audio: play, seek while playing, solo/mute, per-direction waveform
- [ ] Settings: language switch, update check, data folders
- [ ] Window resized narrow (< 1040 px) and wide (> 1920 px)

## 3. Package

```powershell
$env:BUILD_FLAVOR='Portable'; npx electron-builder --win portable --publish never
$env:BUILD_FLAVOR='Setup';    npx electron-builder --win nsis --publish never
```

Artifacts land in `release/`:

| File | Purpose |
| --- | --- |
| `M-Ryuga-Setup-<version>.exe` | Installer |
| `M-Ryuga-Portable-<version>.exe` | Portable |

Smoke-test the packaged portable build once more:

```bash
node scripts/smoke-ui.js release/M-Ryuga-Portable-<version>.exe
```

## 4. Publish

```bash
git add -A
git commit -m "release: v<version>"
git tag v<version>
git push origin main --tags
gh release create v<version> --title "M-Ryuga <version>" \
  --notes-file release-notes.md \
  release/M-Ryuga-Setup-<version>.exe release/M-Ryuga-Portable-<version>.exe
```

> If direct `git push` is unavailable (corporate proxy / blocked 443), push the tree through the
> GitHub REST API (`/git/blobs` → `/git/trees` → `/git/commits` → `/git/refs`) and upload assets with
> `gh release create`. Both paths must produce the same tree.

Release notes must include:

- a one-paragraph summary,
- `### Highlights` bullets,
- `### Downloads` table,
- a Chinese summary (release notes, unlike the README, keep both languages in one file).

## 5. Verify the update path

```bash
curl -s https://api.github.com/repos/Super-Gouba/m-ryuga/releases/latest | jq '.tag_name, .assets[].name'
```

Then in a build **older than the release**: Settings → Software update → Check for updates.
It must report the new version and open the release page.

## 6. Aftercare

- Confirm both assets are downloadable and their sizes match `release/`.
- If the release is broken, mark it as pre-release, publish a fixed patch, and document it in the changelog.
- Keep `.github/workflows/release.yml` in sync; publishing it requires a token with the `workflow` scope.
