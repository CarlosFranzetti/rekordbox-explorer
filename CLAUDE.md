# Rekordbox Explorer — CLAUDE.md

Browser-based reader **and playlist writer** for rekordbox USB exports. Parses the binary
`export.pdb` directly in the browser — no server, no uploads.

**Read `memorystate.md` first.** It carries decisions, landmines and open work.
Format details: `research_playlistHelp.md`. Architecture: `trd.md`.

## Tech Stack

React 18 · Vite (SWC) · TypeScript · TailwindCSS 3 · shadcn/ui (Radix) · React Router 6 ·
Vitest. **No backend, no data-fetching library, no state library.**

## Layering rule

```
components/  →  hooks/  →  lib/usb/  →  lib/pdb/
```

**No React imports below `hooks/`. No `DataView` above `lib/`.** Everything under `lib/` is
pure or I/O-only and unit tested. This is what makes the binary layer testable without a
browser.

## Key Files

| File | Purpose |
|---|---|
| `src/lib/pdb/devicesql.ts` | DeviceSQL string codec (3 encodings) |
| `src/lib/pdb/structure.ts` | File header, page headers, row index, chain walking |
| `src/lib/pdb/playlists.ts` | Playlist row codecs + **the additive writer** |
| `src/lib/rekordbox-parser.ts` | Row layouts → Track/Playlist; drive discovery |
| `src/lib/playlist-draft.ts` | Pure immutable edit model |
| `src/lib/usb/commit.ts` | **The 8-step write pipeline with rollback** |
| `src/lib/usb/backup.ts` | Dual-vault snapshots, verify, rotate, restore |
| `src/lib/usb/fs.ts` | File System Access wrappers, SHA-256, safe filenames |
| `src/lib/device-registry.ts` | IndexedDB index of drives, cross-drive search |
| `src/lib/export/exporters.ts` | CSV / M3U8 / TXT / JSON / rekordbox XML |
| `src/components/LibraryView.tsx` | Responsive shell (panels on desktop, Sheet on mobile) |
| `src/components/playlist/` | Editor + commit dialog |
| `src/components/backup/` | Backups & recovery |
| `src/hooks/useRekordbox.ts` | Drive loading and state |
| `src/hooks/useSettings.ts` | localStorage preferences |

## Dev Commands

```bash
npm run dev      # localhost:8080
npm run build
npm test         # 155 tests
npm run lint
```

## Safety invariants — do not break these

These are enforced by tests. If you change the write path, these tests must still pass.

1. **A write only ever appends.** New pages past EOF; the only bytes patched in the
   original region are the file header's `sequence`/`next_unused_page`, playlist table
   pointers, and one chain-graft `next_page`.
2. **No write without a verified backup** in at least one vault.
3. **A failed write rolls back** automatically.
4. **A restore is itself snapshotted first.**
5. **A damaged backup never overwrites a good library** — checksums are checked first.
6. **Malformed input never hangs or throws out of the parser.**

Only playlist tables (types 7 and 8) are ever written. Track, artist, album, artwork and
analysis data are never modified — that is the core promise, and it is what makes the
risk acceptable.

## Important notes

- **File System Access API** for folders (Chrome/Edge/Opera). Safari/iOS falls back to a
  single-file input and is **read-only**. Gate write UI on `supportsWriteAccess()`.
- Drives are picked `mode: 'read'` and upgraded to `readwrite` only on first write, so
  read-only visitors are never prompted.
- **Themes** are CSS variables in `src/index.css`: `dark`, `midnight`, `light` (sepia),
  `arctic`.
- **Device Library Plus / OneLibrary** is deliberately **not written**. See
  `research_playlistHelp.md` §3.
- **No `console.log` in shipping paths.** The old parser emitted one per album.
- Adding a shadcn component? Only keep it if it is actually imported — 39 unused ones were
  deleted, along with 24 dependencies.

## Testing conventions

- Colocated `*.test.ts` for pure logic.
- `src/test/fixtures/pdb-fixture.ts` builds synthetic `.pdb` images and is written
  **independently of the writer on purpose** — do not refactor it to share the writer's
  encoding, that would defeat the cross-check.
- `src/test/fixtures/memory-fs.ts` is a mock File System Access API with fault injection
  (`corruptWritesMatching`, `failWritesMatching`, `failMkdirMatching`). Use it for anything
  touching a drive.

## Writing for users

Error messages are read by a DJ ten minutes before doors. Say what happened, what state the
drive is in, and what to do. Never make someone guess whether their library survived.

## Donation Links

PayPal `https://paypal.me/losfiesta` · Cash App `https://cash.app/$hypedrum`
