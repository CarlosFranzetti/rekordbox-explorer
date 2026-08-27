# Rekordbox Explorer — CLAUDE.md

Browser-based viewer for rekordbox USB exports. Parses the binary `export.pdb` directly
in the browser — no server, no uploads.

## ⚠️ Read `memorystate.md` first

Two branches, and **which one you are on changes everything**:

| Branch | Contents | Deployed |
|---|---|---|
| **`main`** (this one) | The stable **viewer**. `src/lib/rekordbox-parser.ts` + components. | ✅ Yes |
| **`for-later`** | The **editor** release: `lib/pdb/`, `lib/usb/`, `lib/export/`, playlist editor, backups, device registry, 155 tests. | ⏸️ Rolled back |

The editor was deployed and rolled back after production issues that were never
diagnosed. Do not re-land it without working through P0 in `roadmap.md`.

**Branch rule:** write path, editor, backups, device registry → **`for-later`**.
Low-risk viewer work and docs → **`main`**.

Also: **Vercel Instant Rollback pins the production alias.** Pushing to `main` builds but
does not promote. A human must click *Promote to Production*.

## Tech Stack

React 18 · Vite (SWC) · TypeScript · TailwindCSS 3 · shadcn/ui (Radix) · React Router 6 ·
jsPDF · react-qr-code · Vitest. **No backend.**

## Key Files (on `main`)

| File | Purpose |
|---|---|
| `src/pages/Index.tsx` | Switches between LandingScreen and LibraryView |
| `src/components/LandingScreen.tsx` | File/folder selection |
| `src/components/LibraryView.tsx` | Sidebar + track table |
| `src/components/PlaylistSidebar.tsx` | Playlist tree, settings, theme/font |
| `src/components/TrackTable.tsx` | Resizable, sortable, drag-and-drop columns |
| `src/lib/rekordbox-parser.ts` | Binary `.pdb` parser — the core engine |
| `src/lib/pdf-export.ts` | PDF generation |
| `src/hooks/useRekordbox.ts` | Loading, File System Access API, state |
| `src/hooks/useSettings.ts` | localStorage preferences |
| `src/types/rekordbox.ts` | Track, Playlist, RekordboxDatabase |

## Dev Commands

```bash
npm run dev      # localhost:8080
npm run build
npm run preview
npm test
```

## Important notes

- **File System Access API** for folders (Chrome/Edge/Opera). Safari/iOS falls back to a
  single-file input and is read-only.
- **Themes** are CSS variables in `src/index.css`: `dark`, `midnight`, `light` (sepia),
  `arctic`. Primary is `hsl(200 100% 50%)` = `#00AAFF`.
- **Icons** in `public/` are the hard-drive-in-a-circle mark, all local. The originals
  were hotlinked from a third-party bucket — never reintroduce a remote icon URL.
- **Binary parser** reads Pioneer's `.pdb` as an `ArrayBuffer`. When touching it, prefer
  *degrade gracefully* over *throw* — over-strict validation is a prime suspect for the
  rollback. See `database.md` §1 and `memorystate.md` §2.
- **No `console.log` in shipping paths.**

## If you are working on the write path (`for-later`)

Six invariants, each enforced by a test. Do not break them:

1. A write only ever **appends**; the only bytes patched in the original region are the
   file header's `sequence`/`next_unused_page`, playlist table pointers, and one
   chain-graft `next_page`.
2. No write without a **verified backup** in at least one vault.
3. A failed write **rolls back** automatically.
4. A restore is itself **snapshotted first**.
5. A damaged backup **never overwrites** a good library.
6. Malformed input never hangs or throws out of the parser.

Only playlist tables (types 7 and 8) are ever written.

## Recovery (`src/lib/recovery/`)

**Do not repair a broken library. Find an intact one.** A stick carries several
databases written at different times; the one that was open when the drive was
pulled loses its unflushed pages, the others are fine. That is a search problem.

- **Unwritten is not corrupt.** A file that stops on a page boundary, or is full
  of all-zero pages, was never finished being written. There is nothing to
  repair, and saying "corrupt" sends a DJ hunting for a tool that cannot exist.
  `assess.ts` draws that line; keep it drawn.
- Read damaged SQLite with the **forgiving b-tree walker**, never a real SQLite
  engine — `sqlite3` rejects a truncated file outright, the walker reads what
  survived. That is what made the original recovery possible.
- Assess OneLibrary **after** decrypting; encryption hides blank pages.
- Recovery is **read-only**. It never writes to the drive.
- Output is **rekordbox XML only**. Never synthesise an `export.pdb` — see
  `xml.ts` for why, and do not "improve" this without a CDJ to test against.

## Writing for users

Error messages are read by a DJ ten minutes before doors. Say what happened, what state
the drive is in, and what to do. Never make someone guess whether their library survived.

## Donation Links

PayPal `https://paypal.me/losfiesta` · Cash App `https://cash.app/$hypedrum`
