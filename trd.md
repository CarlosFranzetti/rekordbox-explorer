# Rekordbox Explorer — Technical Reference

How it is built and why. Format details live in `research_playlistHelp.md`.

---

## 1. Stack

React 18 · Vite 7 (SWC) · TypeScript · Tailwind 3 · shadcn/ui (Radix) · Vitest.
No backend, no state library, no data-fetching library — there is no network to fetch from.

## 2. Layering

```
                     ┌─────────────────────────────────────┐
  components/        │ LibraryView · PlaylistEditor        │  React, no binary logic
                     │ BackupsDialog · DevicesDialog       │
                     └───────────────┬─────────────────────┘
                                     │
  hooks/             │ useRekordbox · usePlaylistEditor · useSettings │  state only
                                     │
                     ┌───────────────┴─────────────────────┐
  lib/usb/           │ commit · backup · fs · recovery-note │  drive I/O, orchestration
                     └───────────────┬─────────────────────┘
                                     │
  lib/pdb/           │ playlists · structure · devicesql    │  pure binary codec
  lib/               │ playlist-draft · export/ · zip       │  pure logic
```

**The rule:** everything below `hooks/` is pure or I/O-only and unit tested. No React
imports below `hooks/`. No `DataView` above `lib/`.

## 3. Module map

| File | Responsibility |
|---|---|
| `lib/pdb/devicesql.ts` | DeviceSQL string encode/decode. Honours `DataView.byteOffset`. |
| `lib/pdb/structure.ts` | File header, table pointers, page headers, row index, chain walking. Bounds and cycle guards. |
| `lib/pdb/playlists.ts` | Playlist row codecs + the additive writer + `verifyWrittenPlaylists`. |
| `lib/rekordbox-parser.ts` | Row layouts → `Track` / `Playlist`. Drive discovery. Formatters. |
| `lib/playlist-draft.ts` | Pure immutable edit model. Every op returns a new draft. |
| `lib/usb/fs.ts` | File System Access wrappers, permissions, SHA-256, safe filenames, downloads. |
| `lib/usb/backup.ts` | Dual-vault snapshots, verification, rotation, restore. |
| `lib/usb/commit.ts` | The 8-step write pipeline with automatic rollback. |
| `lib/usb/recovery-note.ts` | `WHATTODOIFTHISWENTTOSHIT.txt` generator. |
| `lib/device-registry.ts` | IndexedDB index of drives, cross-drive search, advice. |
| `lib/export/exporters.ts` | CSV / M3U8 / TXT / JSON / rekordbox XML. Pure strings. |
| `lib/pdf-export.ts` | PDF (lazy-loaded jsPDF) and print. |
| `lib/zip.ts` | Store-only ZIP writer for backup archives. |

## 4. The write pipeline

`commitPlaylists()` in `lib/usb/commit.ts`. Each step reports progress so the UI shows a
live checklist rather than a spinner.

| # | Step | Failure behaviour |
|---|---|---|
| 1 | `permission` | Abort. Nothing touched. |
| 2 | `read` | Abort. |
| 3 | `backup` — both vaults, SHA-256 verified | **Hard gate.** Abort if no vault verifies. |
| 4 | `build` — additive image in memory | Abort. Drive untouched. |
| 5 | `verify-image` — re-parse the in-memory buffer | Abort. Drive untouched. |
| 6 | `write` | **Roll back** from step 3's backup. |
| 7 | `verify-drive` — re-read, compare SHA-256, re-parse | **Roll back.** |
| 8 | `finalise` — refresh the recovery note | Non-fatal. |

Rollback is best-effort and never throws; if it also fails, the message names the backup ID
and points at the on-drive `.txt`.

## 5. Backup vault layout

```
<USB>/
  WHATTODOIFTHISWENTTOSHIT.txt
  RBXPLORER_BACKUPS/                          ← vault 1 (root)
    manifest.json                             ← human-readable, never trusted
    2026-08-05T00-30-12-345Z_pre-write/
      export.pdb
      exportExt.pdb
      backup.json                             ← self-describing: sizes + SHA-256
  PIONEER/rekordbox/
    export.pdb                                ← the live library
    RBXPLORER_SAFETY/                         ← vault 2 (different tree)
      …same snapshots…
```

Four rules this layout encodes:

1. **Two vaults in two trees.** Deleting one folder cannot take the history with it.
2. **Nothing is trusted until read back.** Every copy is re-read and hashed against source.
3. **The manifest is a convenience, never a dependency.** Listing scans directories; each
   snapshot self-describes. A lost `manifest.json` costs nothing.
4. **Rotation deletes only after a new snapshot verifies**, and never the one just created.

Snapshot IDs carry milliseconds plus a collision suffix — two backups in the same second
(manual immediately followed by pre-write) must not collide. This was a real bug the tests
caught.

## 6. Safety invariants

These are enforced by tests, not by convention:

1. **A write only ever appends.** Verified by diffing the entire original region and
   asserting every changed byte is a file-header field, a table pointer, or a chain-graft
   `next_page` — `playlists.test.ts`, *"preserves every original byte and only appends"*.
2. **No write without a verified backup.** `commit.test.ts`, *"aborts before writing when
   the backup cannot be verified"*.
3. **A failed write rolls back.** `commit.test.ts`, *"rolls back automatically when the
   drive fails verification after writing"*.
4. **A restore is undoable.** `backup.test.ts`, *"the pre-restore snapshot can itself be
   restored"*.
5. **A damaged copy never overwrites a good library.** `backup.test.ts`, *"aborts without
   touching the database when the source fails its checksum"*.
6. **Malformed input never hangs or throws out of the parser.** Cycle guards, bounds
   checks, per-row try/catch.

## 7. Testing

`npm test` — 155 tests, no network, no real filesystem.

Two fixtures do the heavy lifting:

- **`test/fixtures/pdb-fixture.ts`** builds synthetic `.pdb` images. Written
  *independently* of the writer — it packs rows tightly where the writer 4-byte-aligns them
  — so round-trip tests cross-check two implementations rather than confirming the writer
  agrees with itself.
- **`test/fixtures/memory-fs.ts`** is an in-memory File System Access API with **fault
  injection**: `failWritesMatching`, `corruptWritesMatching`, `failMkdirMatching`. This is
  what makes "what happens when the drive starts failing mid-write" a unit test instead of
  a hope.

| Suite | Covers |
|---|---|
| `pdb/devicesql.test.ts` | All three encodings, surrogate pairs, bounds, nonzero `byteOffset` |
| `pdb/playlists.test.ts` | Read, write, byte-preservation, multi-page, validation, cycles |
| `rekordbox-parser.test.ts` | Row layouts, near/far name offsets, presence bitmap, malformed input |
| `playlist-draft.test.ts` | Every edit operation, immutability, diffing |
| `usb/backup.test.ts` | Dual vaults, verification, rotation, restore, corruption |
| `usb/commit.test.ts` | All 8 steps, rollback, abort paths |
| `export/exporters.test.ts` | Escaping — CSV formula injection, M3U8 line injection, XML |

## 8. Browser support

| Capability | Chrome / Edge / Opera | Safari / Firefox / iOS |
|---|---|---|
| Open a folder | ✅ | ❌ |
| Read `export.pdb` | ✅ | ✅ via file picker |
| Edit, back up, restore | ✅ | ❌ |
| Export / print | ✅ | ✅ |

Write support is gated on `supportsWriteAccess()` — `showDirectoryPicker` plus
`FileSystemFileHandle.prototype.createWritable`. The directory is picked `mode: 'read'` and
upgraded to `readwrite` only when the user first tries to write, so read-only visitors are
never prompted.

`createWritable()` writes through a swap file and swaps on close, so a crash mid-write
leaves the original intact.

## 9. Security

- **No secrets.** No `.env`, no keys, no server. `.gitignore` covers `.env*` and
  `*.tsbuildinfo`.
- **CSP** in `vercel.json`; `script-src` has no `'unsafe-inline'`.
- **CSV formula injection** neutralised — cells starting `= + - @` get a leading apostrophe.
  Track metadata comes from a file we did not write.
- **M3U8 / XML injection** — newlines stripped, XML-illegal control characters removed.
- **Filenames** derived from track data pass through `safeFileName()`.
- **Bounded allocation** — file size cap, table/page/row caps, cycle guards on hostile input.
- **Analytics** — `@vercel/analytics` sends page views only. Disclosed in `PRIVACY.md`.
- **XSS** — no `dangerouslySetInnerHTML` anywhere. The print window builds HTML from
  escaped strings only.

## 10. Performance

- jsPDF (~400 KB) is dynamically imported. Main bundle 981 KB → 560 KB.
- `exportExt.pdb` merging is skipped below 768 px, where it costs the most.
- Parsing is synchronous on the main thread. A ~10k-track library is ~200 ms; a Web Worker
  is the next step if that becomes a complaint.
- Device track indexes live in IndexedDB, not localStorage — ten libraries would blow the
  5 MB string quota.

## 11. Conventions

- Pure logic gets a colocated `*.test.ts`.
- Comments explain *why*, especially for byte offsets and safety decisions.
- Errors are written for a DJ, not a developer: what happened, what state the drive is in,
  what to do.
- No `console.log` in shipping paths — the old parser emitted one per album.
