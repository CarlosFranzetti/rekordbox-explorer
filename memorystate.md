# Memory State

Context that would otherwise have to be re-derived. Read this first when picking the
project back up — or when a fresh agent session starts cold.

**Last updated:** 2026-08-05 · **Version:** 0.3.0 · **Branch:** `claude/rekordbox-playlist-export-7wndye`

---

## Where things stand

Shipped in this pass: PDB playlist **writing**, dual on-drive backup vaults, an 8-step
verified commit pipeline with automatic rollback, a playlist editor that works on phones,
a device registry, six export formats, and a cleanup that deleted 39 unused UI components
and 24 dependencies.

Tests: **155 passing**, 7 suites. Build: clean. Lint: clean. Typecheck: clean.
Browser-verified on desktop (1440×900) and iPhone 13 viewports.

**Not yet done: tested on real hardware.** Everything is verified against synthetic
fixtures and a mock filesystem. Until a CDJ has read a drive this app wrote, treat the
write path as beta.

---

## Decisions made, with reasons

| Decision | Why | Reversible? |
|---|---|---|
| **Additive writes only** — new pages appended, never overwrite | Original bytes provably survive; failure leaves recoverable data | Yes, but don't |
| **Playlist tables only** | 20-byte + 12-byte rows, no shared string tables. Track/metadata edits touch tables every other row references | Yes, deliberately deferred |
| **Two vaults in two directory trees** | Losing one folder must not lose the history | No, it's the core guarantee |
| **Manifest never trusted for listing** | A corrupt `manifest.json` in a recovery scenario is exactly when you need listing to work | No |
| **4-byte row alignment** | Format targeted 16-bit hardware; costs a few bytes, removes an alignment risk class | Yes |
| **Sample `page_flags` from existing pages** | Both `0x24` and `0x34` occur; mimic what rekordbox did on *this* drive | Yes |
| **Don't write Device Library Plus** | Key known, schema not, no working precedent, AlphaTheta can rotate it | Revisit if someone documents the schema |
| **Pick `mode: 'read'`, upgrade on demand** | Read-only visitors should never see a write prompt | Yes |
| **IndexedDB for the device registry** | 10 libraries × 5k tracks blows localStorage's 5 MB | Yes |
| **Dropped `@tanstack/react-query`** | Zero `useQuery` calls existed. No network to fetch from | Yes |
| **Lazy-load jsPDF** | 400 KB for a feature most sessions never use | Yes |

## Bugs found and fixed this pass

1. **Backup ID collision.** Second-granularity timestamps meant a manual backup immediately
   followed by a pre-write backup overwrote each other. Now millisecond timestamps plus a
   collision-check suffix. *Caught by a test, not by review.*
2. **`DataView.byteOffset` ignored** in the old string reader — latent, would have broken
   any future chunked parsing.
3. **Off-by-one** in long-form string bounds (`>=` should have been `>`).
4. **Album parsing was four guesses** with a `console.log` per album firing in production.
   Replaced with the documented layout: `subtype & 0x04` selects a u16 at `0x16`, else a u8
   at `0x15`.
5. **No-op validations** — `rating > 255` on a `getUint8`, `length > 65535` on a
   `getUint16`. Removed.
6. **Mobile layout was broken.** The resizable two-pane shell rendered unconditionally, so
   a phone got a squeezed sidebar and a 1px mouse-only drag handle. Now a Sheet drawer
   below 768 px.

## Landmines

- **`empty_candidate`, `index_shift`, and "strange" pages (`page_flags & 0x40`)** are still
  undocumented. Not known to matter for playlists. Not proven irrelevant.
- **A rekordbox re-export wipes device-only playlists.** Expected, but users will be
  surprised. Worth surfacing in the UI.
- **CDJ-3000 firmware 3.30** prioritised OneLibrary and was pulled by AlphaTheta. If it
  returns, legacy-only drives stop working on that model.
- **`src/hooks/use-toast.ts`** has an `_actionTypes` const only used as a type. Cosmetic.
- **Main bundle is still 560 KB.** Next win is code-splitting the dialogs.

## Test infrastructure worth knowing about

- `test/fixtures/pdb-fixture.ts` — builds synthetic `.pdb` images. **Written independently
  of the writer on purpose** (tight packing vs. the writer's 4-byte alignment) so round-trip
  tests cross-check two implementations.
- `test/fixtures/memory-fs.ts` — in-memory File System Access API with fault injection.
  `corruptWritesMatching` is how "the drive silently corrupts a write" became a unit test.

To regenerate a demo `export.pdb` for manual testing, write a throwaway test that calls
`buildPdb(...)` and `writeFileSync`s the result — see the git history of this file's commit
for the exact script.

## What to do next

1. **Hardware validation.** CDJ-2000NXS2, CDJ-3000, XDJ-XZ. Then a rekordbox re-import
   check, then a rekordbox → Device Library Plus conversion check. Until this is done the
   write path stays labelled beta.
2. Code-split the dialogs.
3. Web Worker for parsing if large libraries feel slow.
4. Then `roadmap.md`.

## Vision context

This is the browser tier of something larger. `rickordbox` is the desktop ambition; `djOS`
is the umbrella; `RA-NYC` is the events/social side (locally moderated by appointed
ambassadors, suggesting contacts and events to visiting DJs, eventually routing tours from
attended-events history + Discogs + your actual USB contents).

The through-line: **your library, your drives, your history — local-first, yours.** The
shared primitive is the device registry, which already knows what is on which drive.
