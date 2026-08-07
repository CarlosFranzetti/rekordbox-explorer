# Roadmap

Ordered by *what unblocks the next thing*, not by excitement.

---

## Now — v0.3.1: earn the trust

Nothing new ships until the write path is proven on metal.

- [ ] **Hardware test matrix.** Create a playlist here, then load the drive on:
      CDJ-2000NXS2 · CDJ-3000 (fw ≤ 3.22) · XDJ-XZ · XDJ-1000MK2. Record results in
      `docs/HARDWARE.md`.
- [ ] **Rekordbox round-trip.** Confirm a device-written playlist appears in Export mode and
      imports into the collection.
- [ ] **Device Library Plus conversion.** Confirm rekordbox 6.6.11+ converts a
      device-written legacy library so it reaches an OPUS-QUAD.
- [ ] Drop the "beta" label on writing once all three pass.
- [ ] Code-split the dialogs (560 KB main bundle → target < 350 KB).

## Next — v0.4: read everything

- [ ] **ANLZ reading** (`PIONEER/USBANLZ/**/*.DAT/.EXT`) — waveform preview, beatgrid, hot
      cues and memory points in the track view. Read-only. Biggest single UX jump available.
- [ ] **Device Library Plus reading** so OPUS-QUAD-only drives stop showing as unreadable.
      Needs SQLCipher-in-WASM. Read-only, permanently.
- [ ] **Artwork** from the `artwork` table.
- [ ] **History playlists** (page types 11/12) — what you actually played, per gig.
- [ ] **MyTag** from `exportExt.pdb`.
- [ ] Web Worker parsing.

## Then — v0.5: the crate-digging tier

- [ ] **Compare two drives** side by side: what's on A and not B.
- [ ] **Sync a playlist** from one drive to another.
- [ ] **Smart playlists** — build from BPM / key / genre / rating filters, save to the drive.
- [ ] **Harmonic suggestions** — Camelot-adjacent tracks at a compatible tempo.
- [ ] **Drive health check** before a gig: orphaned entries, tracks whose files are missing,
      missing ANLZ, filesystem type, free space.
- [ ] **Set timeline** — durations totalled, so a printed setlist shows when you finish.

## Later — v1.0: the library manager

- [ ] **rekordbox XML import**, not just export. Round-trips through the sanctioned format.
- [ ] **Clone a drive**, verified file by file. The single most requested DJ utility.
- [ ] **Cross-drive dedupe** with actions, not just detection.
- [ ] **Backup vault on disk**, not just on each drive — a local archive across all sticks.
- [ ] PWA / offline install.

---

## Beyond the browser

Deliberately out of scope here; recorded so the seams are designed for.

**rickordbox — the desktop tier.** What a browser cannot do: read the rekordbox 6/7
`master.db` (SQLCipher; `pyrekordbox` proves it is writable), copy audio, and — the real
prize — **write ANLZ files**. Note the trap already identified: CDJs do not analyse tracks.
An export with no ANLZ plays but shows no waveform, no beatgrid, no cues. That is the cost
of "actually works", and it is not small.

**djOS — the umbrella.** Local-first DJ toolchain. The shared primitive already exists here:
the **device registry** knows what is on which drive. Everything else hangs off that.

**RA-NYC — the events tier.** Locally moderated by appointed ambassadors; suggests contacts,
events and submissions to DJs new in town or passing through. The long game is tour routing
from three signals this ecosystem already touches: events attended, Discogs collection, and
what is actually on your drives.

The through-line: **your library, your drives, your history — local-first, yours.**

---

## Deliberately not doing

| | Why |
|---|---|
| Writing Device Library Plus | Key known, schema not, no working precedent, AlphaTheta can rotate it |
| Editing track metadata | Touches string tables every other row references. Much more risk than playlists, much less benefit |
| Cloud sync / accounts | The entire pitch is that nothing leaves your machine |
| Bundling a rekordbox key | Reading your own data is defensible; shipping their key is not |
