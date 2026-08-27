# Rekordbox Explorer — Product Requirements

**Status:** viewer live on `main`; editor built and parked on `for-later` after a
production rollback · **Owner:** Carlos Franzetti

> Everything under "Shipped (v0.3)" below is **built and tested but not currently
> deployed** — it lives on `for-later`. Production serves the viewer. See
> `memorystate.md`.

---

## 1. The problem

A DJ's library lives in one place they cannot inspect: a USB stick formatted by rekordbox.
To see what is on it you must install a 1 GB application, launch it, and wait. To change
one playlist you must do that at a desk, not in a booth. And if the stick's database breaks
— which it does, routinely, from an unsafe eject — there is no repair tool. The official
answer is *reformat and re-export*.

## 2. Who this is for

| | Need |
|---|---|
| **Gigging DJ** (primary) | Check what's on a stick from any laptop. Fix a playlist ten minutes before doors. Print a setlist. |
| **DJ with many sticks** | Which drive has that track? Which one hasn't been backed up? |
| **DJ who has been burned** | Recover a library that a player just called corrupt. |
| **Curious / dev** | Read the binary format without installing anything. |

## 3. Principles

1. **Never lose someone's library.** Every write is preceded by two verified backups and
   followed by read-back verification, with automatic rollback. If safety and features
   conflict, safety wins.
2. **Nothing leaves the browser.** No uploads, no accounts, no server.
3. **Honest about limits.** Say plainly which players will and will not read a drive.
4. **Usable in a dark booth.** Big text option, big touch targets, works on a phone.
5. **Recoverable without us.** The drive carries plain-text instructions that work with
   nothing but a file manager.

## 4. Scope

### Built (v0.3 — parked on `for-later`)

| Area | Requirement |
|---|---|
| **Read** | Parse `export.pdb` in-browser: tracks, artists, albums, genres, keys, labels, playlist tree. Merge `exportExt.pdb` for missing BPM/genre. |
| **Browse** | Sortable, resizable, reorderable track table. Playlist tree. Raw file browser. Search. |
| **Edit** | Create / rename / delete playlists and folders. Add, remove and reorder tracks. Undo / redo. Staged until saved. |
| **Write** | Additive `export.pdb` write of playlist tables only. Existing data preserved byte-for-byte. |
| **Backups** | Rotating snapshots (3–20, default 5) in **two** on-drive vaults. SHA-256 verified on write and on demand. |
| **Recovery** | In-app browse / verify / restore / export / delete. Restore is itself snapshotted. `WHATTODOIFTHISWENTTOSHIT.txt` at the drive root, rewritten on every write. |
| **Devices** | Local index of every drive opened. Search across all of them. Duplicate detection. Backup/clone advice. Export/import the index. |
| **Export** | PDF, print, CSV, M3U8, plain text, JSON, **rekordbox XML**. |
| **Compatibility** | Detect legacy vs Device Library Plus, state exactly which hardware reads the drive. |
| **Accessibility** | 10–28 px text scaling with presets, ≥44 px touch targets, keyboard-operable, labelled controls. |

### Explicitly out of scope

- **Writing OneLibrary to a drive.** The library layer exists and is tested — see
  `database.md` — but it is not wired into the app's backup-and-rollback pipeline yet, and
  nothing has been validated on real hardware. Reading is shipped; writing is not.
  Superseded entry: this used to read "key is known, schema is not, nobody has demonstrated
  a working writer". The schema is documented now and a writer exists.
- **Writing ANLZ files** (waveforms, beatgrids, hot cues). Different format, much larger
  job, and the failure mode is a library that looks fine and is useless on stage.
- **Editing track metadata.** Retagging touches string tables shared with every other row —
  far riskier than playlists for far less benefit.
- **Copying audio onto a drive.** That is a full exporter, not a viewer.
- **Any server component.**

## 5. Success criteria

| Metric | Target |
|---|---|
| Libraries lost to a bug in this app | **0** |
| Write attempts that leave the drive unverified or un-rolled-back | **0** |
| Time from opening the app to seeing your library | < 10 s |
| A playlist created here loads on a CDJ-2000NXS2 and a CDJ-3000 | Yes |
| Recoverable from a broken library with no internet | Yes, via the drive's own `.txt` |

## 6. Key flows

**Edit a playlist** → open drive → *Edit* → change things (staged, undoable) → *Save to
USB* → confirmation lists every change → backup runs and verifies → write → read back and
verify → done. Any failure rolls back and says so.

**Recover** → open drive → *Backups & recovery* → pick a snapshot → *Verify* → *Restore*.
Current state is snapshotted first, so the restore is undoable.

**Find a track across drives** → *My drives* → *Search all* → shows which stick has it.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Undocumented PDB fields break a player | Additive writes only; playlist tables only; byte-diff test; hardware test matrix before promoting out of beta |
| User blames us for pre-existing corruption | Snapshot on first open; recovery note explains the common causes (unsafe eject) |
| Newer gear can't read the result | Compatibility badge states it up front; recovery note explains the rekordbox conversion |
| Reverse-engineering / EULA | Read-only for the encrypted format; no key redistribution; XML is the sanctioned path |

## 8. Where it goes next

See `roadmap.md`. Short version: hardware validation → ANLZ reading → Device Library Plus
reading → this becomes the browser tier of a larger local-first DJ toolchain (djOS).
