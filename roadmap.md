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
| **Check Deployment Protection in an incognito window** — SSO definitely gates the preview; production's status is ambiguous (setting says gated, observed response says open). See `memorystate.md` §1b. | *Vercel setting* |
| Bundle: `main`'s main chunk is 863 KB (280 KB gzipped), `for-later`'s is ~560 KB — code-split the dialogs | both |
| Web Worker for parsing (large libraries block the main thread) | `for-later` |
| **Mobile layout is broken on `main`** — `LibraryView` renders `ResizablePanelGroup` unconditionally with a mouse-only 1px drag handle. `for-later` fixed it with a `Sheet` drawer below 768px. Safari/iOS is the documented fallback audience, so this is user-facing today. | backport to `main` |
| Accessibility fixes (currently only on `for-later`) | consider backporting to `main` |
| Scaffold bloat on `main`: delete `NavLink.tsx`, ~20 unreferenced shadcn components, 24 unused deps (incl. `@tanstack/react-query` with zero `useQuery` calls); lazy-load `jspdf` (~400 KB eager). `for-later` already did all of it. | `main` |
| Correct the Rescue-tab promise in `recovery-note.ts:115` — the on-drive note describes a drive-scan feature the tab does not implement | `for-later` |
| Dead `rating > 255` check on a `getUint8` — impossible condition posing as validation | `main` |
| ~~`tsconfig.*.tsbuildinfo` still tracked~~ — done 2026-08-14 | `main` |
| ~~`console.log` per album row in the parser~~ — done 2026-08-14 | `main` |
| ~~`package.json` still carried the Lovable scaffold's name/version, no `license`/`repository`~~ — done 2026-08-14 | `main` |

## P3 — Read everything → `for-later`

- [ ] **ANLZ reading** (`PIONEER/USBANLZ/**/*.DAT/.EXT`) — waveform, beatgrid, hot cues,
      memory points. Read-only. Biggest single UX jump available.
- [ ] **Device Library Plus reading** so OPUS-QUAD-only drives stop showing as unreadable.
      Needs SQLCipher-in-WASM. Read-only, permanently. See `database.md`.
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
| Writing Device Library Plus | Key known, schema not, no working precedent, key can rotate |
| Editing track metadata | Touches string tables every other row references |
| Cloud sync / accounts | The entire pitch is that nothing leaves your machine |
| Bundling a rekordbox key | Reading your own data is defensible; shipping their key is not |
