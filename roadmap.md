# Roadmap

Every item says **which branch it belongs on**. Two branches are live:

| Branch | What it is | Deploys? |
|---|---|---|
| **`main`** | The stable **viewer** + current icon set. What production serves. | Production — builds automatically, **needs a manual promote** (see `memorystate.md` §1) |
| **`for-later`** | The parked **editor** release: PDB writer, backups, commit pipeline, device registry, exports, parser rewrite, 155 tests. | Preview — auto-deploys to `rekordbox-explorer-git-for-later-carlosfranzettis-projects.vercel.app` |

A third remote branch, `claude/rekordbox-playlist-export-7wndye`, is stale and superseded
by these two. It can be deleted.

**Rule:** anything touching the write path, the editor, backups, or the device registry
goes on **`for-later`**. Only low-risk viewer work and docs go on **`main`**.

Full deployment topology, protection settings, and analytics state: `memorystate.md` §1b.

---

## P0 — Unblock the rollback → `for-later`

Nothing re-lands until these are done.

- [ ] **Capture the actual production error.** Console output or a repro. Everything below
      item 2 is educated guessing without it. → *needs the user*
- [ ] **Add a React error boundary** around the app. There isn't one, so any render-time
      throw is a blank white page — which is what a broken deploy looks like from outside.
      `src/App.tsx` → `for-later`
- [ ] **Relax `readFileHeader`'s page-alignment throw** to a warning. It currently rejects
      any `export.pdb` whose size isn't an exact multiple of the page size; the old parser
      never required that. `src/lib/pdb/structure.ts` → `for-later`
- [ ] **Make `walkTablePages` skip a wrong-typed page instead of ending the walk.**
      `structure.ts:212` currently `return`s, discarding every remaining page in the chain;
      the old parser skipped the page and kept going. Today this silently truncates a
      library with no error shown — promoted after the 2026-08-14 review, which found it
      fits the un-captured symptom better than the alignment throw does.
      `src/lib/pdb/structure.ts` → `for-later`
- [ ] **Soften the table-count cap** (64 vs the old 1000). Low real-world risk — the format
      has ~20 known table types — but prefer "skip and carry on" over "throw". → `for-later`
- [ ] **Harden IndexedDB**: don't cache a rejected `dbPromise`, handle `onblocked`, and add
      a timeout so a blocked open can't hang. `src/lib/device-registry.ts` → `for-later`
- [ ] **Test against a real `export.pdb`.** Every existing test uses fixtures we generated,
      which are page-aligned by construction — structurally blind to P0 item 3.
      → *needs the user*
- [ ] Re-land as a fresh PR from `for-later`, promote, and watch it.

## P1 — Earn trust in the write path → `for-later`

- [ ] **Hardware matrix**: create a playlist, then load on CDJ-2000NXS2 · CDJ-3000 (fw
      ≤3.22) · XDJ-XZ · XDJ-1000MK2. Record in `docs/HARDWARE.md`.
- [ ] **Rekordbox round-trip**: device-written playlist appears in Export mode and imports.
- [ ] **Device Library Plus conversion**: rekordbox 6.6.11+ converts a device-written
      legacy library so it reaches an OPUS-QUAD.
- [ ] Drop the "beta" label on writing once all three pass.

## P2 — Ship-quality gaps → `main` (safe) and `for-later` (rest)

| Item | Branch |
|---|---|
| GitHub repo topics (`docs/TOPICS.md` has the command) | *repo setting* |
| Upload `og-image.png` as GitHub social preview | *repo setting* |
| **Promote the pinned Vercel deployment** — production still serves the pre-rollback build | *Vercel setting* |
| **Enable Web Analytics** — `<Analytics />` is mounted on both branches but the project has it off, so every beacon is dropped | *Vercel setting* |
| Deployment Protection — resolved, no action needed: production domain is public, all previews and branch aliases are SSO-gated and `noindex`. See `memorystate.md` §1b. | *Vercel setting* |
| Bundle: `main`'s main chunk is 863 KB (280 KB gzipped), `for-later`'s is ~560 KB — code-split the dialogs | both |
| Web Worker for parsing (large libraries block the main thread) | `for-later` |
| ~~Mobile layout is broken on `main`~~ — **not a bug.** The `Sheet` drawer on `for-later` was the regression and has been reverted: playlists and the full column set are visible on a phone, same layout as desktop. Pinned by `LibraryView.mobile.test.tsx`. | done 2026-08-27 |
| **No musical Key column** — `Track.key` is parsed and carried but `DESKTOP_COLUMNS` never shows it. Harmonic mixing is a core reason to check a library on a phone. | both |
| Accessibility fixes (currently only on `for-later`) | consider backporting to `main` |
| **Lazy-load `jspdf`** — still an eager top-level import, ~400 KB in the main chunk for a feature most sessions never use. `for-later` already uses a dynamic `import('jspdf')`. | `main` |
| ~~Scaffold bloat on `main`: 42 dead modules, 35 unused packages, the scaffold's component-tagger plugin~~ — done 2026-08-14 | `main` |
| Correct the Rescue-tab promise in `recovery-note.ts:115` — the on-drive note describes a drive-scan feature the tab does not implement | `for-later` |
| Dead `rating > 255` check on a `getUint8` — impossible condition posing as validation | `main` |
| ~~`tsconfig.*.tsbuildinfo` still tracked~~ — done 2026-08-14 | `main` |
| ~~`console.log` per album row in the parser~~ — done 2026-08-14 | `main` |
| ~~`package.json` still carried the original scaffold's name/version, no `license`/`repository`~~ — done 2026-08-14 | `main` |

## P3 — Read everything → `for-later`

- [ ] **ANLZ reading** (`PIONEER/USBANLZ/**/*.DAT/.EXT`) — waveform, beatgrid, hot cues,
      memory points. Read-only. Biggest single UX jump available.
- [x] ~~**Device Library Plus reading**~~ — done, and it needed no WASM. Moved to P7.
- [ ] **Artwork** from the `artwork` table (page type 13).
- [ ] **History playlists** (types 11/12) — what you actually played, per gig.
- [ ] **MyTag** from `exportExt.pdb` (types 3/4).

## P4 — The crate-digging tier → `for-later`

- [ ] **Compare two drives** side by side: what's on A and not B.
- [ ] **Sync a playlist** from one drive to another.
- [ ] **Smart playlists** — build from BPM / key / genre / rating filters, save to drive.
- [ ] **Harmonic suggestions** — Camelot-adjacent at a compatible tempo.
- [ ] **Drive health check** before a gig: orphaned entries, missing files, missing ANLZ,
      filesystem type, free space.
- [ ] **Set timeline** — durations totalled, so a printed setlist shows when you finish.

## P5 — Library manager → new branch off `for-later`

- [ ] **rekordbox XML import** (export already exists). Round-trips the sanctioned format.
- [ ] **Clone a drive**, verified file by file. Most-requested DJ utility.
- [ ] **Cross-drive dedupe** with actions, not just detection.
- [ ] **Backup vault on disk**, not just per-drive.
- [ ] PWA / offline install (manifest already shipped on `main`).

## P7a — Drive compatibility check → **shipped on both branches**

"Will this stick work in the booth?" — answered before you leave the house.

- [x] Detect the legacy library and OneLibrary, checking `PIONEER/rekordbox/exportLibrary.db`,
      `PIONEER/rekordbox/library/*.db` and `PIONEER/DeviceLibraryPlus/`. Detection is
      permissive on purpose: a false negative tells a DJ their stick is legacy-only when
      it is not, which is the exact failure this prevents.
- [x] Report support per player generation, not per file, with a fix for each problem
- [x] Compare playlists across both libraries when a drive carries both — a drive whose
      two libraries disagree shows different playlists in different booths
- [x] Warn on an unflushed `-wal`
- [x] 19 tests
- [ ] Compare **track membership**, not just playlist names and counts. The two databases
      use different id spaces, so this needs matching on file path.
- [ ] Check the audio files referenced actually exist on the drive

**Fixed a real bug doing this:** detection previously only looked for a
`PIONEER/DeviceLibraryPlus` folder, which rekordbox never writes. `hasPlus` was therefore
false on every real drive, and OneLibrary-only sticks were reported as "partial".

## P7 — OneLibrary → `for-later`

The format AlphaTheta shipped in October 2025 for CDJ-3000X, XDJ-AZ, OPUS-QUAD,
OMNIS-DUO and CDJ-3000 fw 3.15+. **Reading and playlist writing both work**, in the
browser, with no WASM and no server — see `database.md` §OneLibrary.

- [x] SQLCipher 4 decrypt/encrypt via WebCrypto (`src/lib/onelibrary/sqlcipher.js`)
- [x] Read `content` / `playlist` / `playlist_content` into the app's model
- [x] Create, replace and delete playlists, verified in memory before any write
- [x] 18 tests against a real encrypted export
- [ ] **Wire the reader into `useRekordbox`** so a OneLibrary-only drive stops
      reporting as unreadable. Currently the library layer exists but the load
      path still only looks for `export.pdb`.
- [ ] **Route OneLibrary writes through `commitPlaylists`** so they get the same
      backup gate, verify and rollback the PDB path has. The writer is ready and
      returns a verified image; only the pipeline wiring is missing.
- [ ] **Surface the WAL warning in the UI.** `loadOneLibrary` returns one; nothing
      displays it yet. A silently-truncated library is the worst failure mode here.
- [ ] Decide the precedence rule when a drive carries both libraries. AlphaTheta
      says the player prefers OneLibrary; the app should say which one it is showing.
- [ ] ANLZ writing, without which cues do not exist on a written device.

## P8 — Recover a damaged drive → **shipped on both branches**

Built against a real casualty and verified against it: 52 playlists, 721 tracks
and 1,391 entries recovered from a drive whose rekordbox databases were 93-96%
unwritten. Full write-up in `memorystate.md` §1f.

- [x] Health assessment for PDB and SQLite: header-vs-size truncation, all-zero
      page census, and the *unwritten vs damaged* distinction that decides the advice
- [x] Journal and `-wal` detection, including the zero-length case
- [x] OneLibrary decrypt, then assess the decrypted image
- [x] Engine DJ (`Engine Library/Database2/m.db`) as an alternate source
- [x] Score every library found, rebuild from the healthiest
- [x] rekordbox XML output — the safe restore path
- [x] "Attempt USB recovery" in the app, read-only, never writes
- [x] 14 tests on synthetic fixtures reproducing the real failure shape
- [ ] **Serato and Traktor as further sources.** Same premise as Engine: another
      library on the same stick that was not open when it died.
- [ ] **Carve unallocated space** for a previous `export.pdb`. exFAT does not zero
      freed blocks, so the old database often still exists. Needs raw block access,
      which a browser cannot do — a desktop-tier feature.
- [ ] Match tracks across sources by file path so a partial legacy library can be
      merged with a healthy Engine one rather than one replacing the other.
- [ ] Recover cues from `PIONEER/USBANLZ` — they survive independently of every
      database, one file per track, and are pure gold when a library dies.

## P9 — Audition player → **shipped on both branches**

A transport pinned to the bottom, modelled on the RA-NYC PlayerBar. Double-click
a row on desktop, single tap on mobile. The queue is whatever is on screen, so
next/previous follow the current sort and filter.

- [x] Two engines: `<audio>` for what the browser decodes, Web Audio for AIFF
- [x] **An AIFF decoder** (`src/lib/audio/aiff.ts`), because Chrome cannot decode
      AIFF by either route and Chrome is the only browser with the File System
      Access API this app needs. 16/24/32-bit, 8-bit signed, float, `sowt`,
      arbitrary sample rates. 14 tests.
- [x] Bar publishes `--player-h` so the table reserves space rather than hiding
      rows underneath it
- [ ] **Waveform from ANLZ.** `PIONEER/USBANLZ` already holds the waveform and
      beatgrid for every track; drawing it in the scrubber is the obvious next
      step and needs the ANLZ reader from P3.
- [ ] Cue-point markers on the scrubber, same source.
- [ ] Remember volume across sessions.
- [ ] Media Session API so the OS lock screen and headphone buttons work.

## P6 — Open-source hygiene → `main`

The repo is already open source — public, MIT, licence detected by GitHub. Nothing to
apply to. Full explanation and reasoning in `docs/OPEN-SOURCE.md`.

- [x] MIT `LICENSE` in the repo, detected by GitHub
- [x] `README` / `CONTRIBUTING` / `SECURITY` / `PRIVACY`
- [x] `package.json` carries `license`, `repository`, `homepage`, `bugs`
- [ ] Repo topics (`docs/TOPICS.md`) — *repo setting*
- [ ] Social preview image upload — *repo setting*
- [ ] `CODE_OF_CONDUCT.md` (GitHub generates the Contributor Covenant for you)
- [ ] Credit the reverse-engineering prior art in the README, not just in
      `research_playlistHelp.md` — Deep Symmetry's crate-digger, @henrybetts, @flesniak
- [ ] Tag `v0.2.0` and cut a GitHub Release

---

## Beyond this repo

**rickordbox — desktop tier.** What a browser cannot do: read the rekordbox 6/7
`master.db`, copy audio, and — the real prize — **write ANLZ files**. See `database.md`.

**djOS — the umbrella.** Local-first DJ toolchain. Shared primitive: the device registry.

**RA-NYC — events tier.** Locally moderated by appointed ambassadors; suggests contacts,
events and submissions to DJs new in town. Long game: tour routing from events attended +
Discogs + what's actually on your drives.

---

## Deliberately not doing

| | Why |
|---|---|
| ~~Writing Device Library Plus~~ | **Reversed 2026-08-27.** The schema is now documented and both directions are implemented and tested — see P7. |
| Editing track metadata | Touches string tables every other row references |
| Cloud sync / accounts | The entire pitch is that nothing leaves your machine |
| Writing cues to OneLibrary's `cue` table | rekordbox leaves it empty and puts cues in ANLZ. Filling it produces a device with no cues on it. |
