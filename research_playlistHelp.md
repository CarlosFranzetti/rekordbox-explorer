# Research: writing playlists to a rekordbox USB

Everything learned while answering: *can a browser app create and modify playlists on a
real rekordbox USB, and what breaks?* Written up so nobody has to re-derive it.

**Short answer: yes for playlists, on the legacy `export.pdb`, and it is one of the safest
possible writes to that format. "Works on all players" is not achievable this way, and the
corruption risk is real but bounded and mitigable.**

---

## 1. The format

`PIONEER/rekordbox/export.pdb` is a DeviceSQL database — Pioneer's own embedded format,
originally targeting 16-bit devices with 32 KB of RAM. It was reverse-engineered by
@henrybetts, @flesniak and James Elliott; the canonical spec is
[Deep-Symmetry/crate-digger's `rekordbox_pdb.ksy`](https://github.com/Deep-Symmetry/crate-digger/blob/main/src/main/kaitai/rekordbox_pdb.ksy).

### File header (`src/lib/pdb/structure.ts`)

| Offset | Size | Field |
|---|---|---|
| `0x00` | u4 | zero |
| `0x04` | u4 | `len_page` — page size, typically 4096 |
| `0x08` | u4 | `num_tables` |
| `0x0C` | u4 | `next_unused_page` — points past the end of file |
| `0x10` | u4 | unknown |
| `0x14` | u4 | `sequence` — bumped on every edit |
| `0x18` | u4 | gap |
| `0x1C` | 16×n | table pointers |

Table pointer: `type u4`, `empty_candidate u4`, `first_page u4`, `last_page u4`.

### Page header (0x28 bytes, heap follows)

| Offset | Size | Field |
|---|---|---|
| `0x04` | u4 | `page_index` (sanity check) |
| `0x08` | u4 | `type` |
| `0x0C` | u4 | `next_page` (past EOF terminates the chain) |
| `0x10` | u4 | `sequence` |
| `0x18` | b13 | `num_row_offsets` — slots ever allocated |
| `0x18` | b11 | `num_rows` — slots currently valid |
| `0x1B` | u1 | `page_flags` — `& 0x40` set means *not* a data page |
| `0x1C` | u2 | `free_size` |
| `0x1E` | u2 | `used_size` |
| `0x20` | u2 | `transaction_row_count` |
| `0x22` | u2 | `transaction_row_index` |

The 13/11-bit split at `0x18` is little-endian bit-packed, so reading a LE u32 there gives
`num_row_offsets` in bits 0–12, `num_rows` in bits 13–23, `page_flags` in bits 24–31.

### Row index

Built **backwards** from the end of the page in 36-byte (`0x24`) groups of up to 16 rows.
For group `g`, `base = len_page - g * 0x24`:

- `base - 6 - 2i` — u2 offset of row `i`, relative to the end of the page header
- `base - 4` — u2 `row_present_flags`
- `base - 2` — u2 `transaction_row_flags`

Rows whose present bit is clear **must be ignored** — the spec is explicit that they may
not even be well-formed.

### DeviceSQL strings

| First byte | Encoding |
|---|---|
| odd | short ASCII, `len = byte >> 1` counting the header byte |
| `0x40` | long ASCII: u2 length at +1, pad at +3, payload at +4 of `len - 4` |
| `0x90` | long UTF-16LE, same framing |

### Playlist rows — why this is the easy write

```
playlist_tree_row               playlist_entry_row
  0x00 u4 parent_id (0 = root)    0x00 u4 entry_index
  0x04 u4 unknown                 0x04 u4 track_id
  0x08 u4 sort_order              0x08 u4 playlist_id
  0x0C u4 id
  0x10 u4 raw_is_folder
  0x14    name (DeviceSQL string)
```

A new playlist is **one 20-byte row plus N 12-byte rows**. No string interning, no track
rows touched, no artwork, no analysis. Compare that to a full exporter like
[rex](https://github.com/kimtore/rex), whose README says outright *"Do not use files
generated from this project on a live gig"* and lists waveforms, beatgrid and hot cues as
unsupported.

`exportExt.pdb` holds only `tags` / `tag_tracks` (MyTag). Playlists live solely in
`export.pdb`, so a playlist write never desynchronises the two files.

---

## 2. The write strategy we implemented

Implemented in `src/lib/pdb/playlists.ts`. **Purely additive.**

1. Re-encode both playlist tables into brand-new pages appended past the old EOF.
2. Patch only these already-written bytes:
   - file header `sequence` and `next_unused_page`
   - each playlist table pointer's `first_page` / `last_page`
   - at most one existing page's `next_page`, to graft the new chain on
3. Everything else survives **byte-for-byte**. Old pages are orphaned but intact.

This is enforced by a test that diffs the whole original region after a write and asserts
every changed byte falls in one of those three known windows
(`src/lib/pdb/playlists.test.ts`, *"preserves every original byte and only appends"*).

Other decisions worth knowing:

- **Chain head reuse.** A table's `first_page` is normally an empty placeholder. We keep it
  and repoint its `next_page`. If it *does* hold rows, we re-encode them and repoint
  `first_page` instead.
- **4-byte row alignment.** Row bodies open with u32 fields and the heap starts at `0x28`.
  Alignment costs a few bytes per row and removes a whole class of risk on hardware that
  was designed around aligned loads.
- **Page flags are sampled, not guessed.** We copy `page_flags` from an existing data page
  of the same table (`0x24` and `0x34` both occur) so new pages look like rekordbox's own.
- **Track ordering.** Entries are grouped by playlist and numbered from zero, matching how
  rekordbox lays them out.

### Remaining unknowns

`empty_candidate` in the table pointer, `index_shift` in most rows, and the "strange"
non-data pages (`page_flags & 0x40`). None are known to matter for playlists. Nobody has
proven they don't. This is the honest residual risk.

---

## 3. Player compatibility — the real ceiling

| Hardware | Reads `export.pdb`? |
|---|---|
| CDJ-2000 / nexus / NXS2, CDJ-900, XDJ-1000 / RX / XZ, CDJ-3000 (fw ≤ 3.22) | ✅ |
| **OPUS-QUAD, OMNIS-DUO, XDJ-AZ, CDJ-3000X** | ❌ OneLibrary only — *"Rekordbox Device Library Plus not found!"* |
| CDJ-3000 fw 3.30 | ⚠️ Prioritised OneLibrary; [AlphaTheta pulled the firmware](https://musictech.com/features/pioneer-dj-cdj-3000-firmware-bug-jaguar-mojaxx/) |

Device Library Plus / OneLibrary is a **SQLCipher-encrypted SQLite** database
(`exportLibrary.db`). The key has been recovered and is public — base85 decode → XOR →
zlib inflate, shared across all devices ([notes](https://gist.github.com/0xdevalias/b803476793b56f7c45e6361799168eb0)).
Several projects **read** it (`pyrekordbox`, `onelibrary-connect`). **Nobody has
demonstrated writing it**, the schema is undocumented, and AlphaTheta can rotate the key in
any firmware release. We do not attempt it.

**The bridge that does work:** plug the drive into rekordbox 6.6.11+ and it converts the
*on-device* legacy library into Device Library Plus. This is exactly what VirtualDJ users
do — *"if you make changes on the USB stick via VirtualDJ, only the device library is
adapted, and you need to convert it in Rekordbox to update the device library plus as
well."* So playlists written here can reach an OPUS-QUAD, just not without that step.

---

## 4. Rekordbox round-trip

Rekordbox in Export mode reads `export.pdb` from the device, so a correctly written
playlist shows up under Devices and can be imported into the collection.

- Rekordbox does **not** merge device changes into your collection automatically.
- If rekordbox later re-exports to that USB, it **rewrites `export.pdb` from its own
  state** — playlists that exist only on the device are gone.
- `exportExt.pdb` is untouched by playlist writes, so nothing desynchronises.

---

## 5. Corruption risk, honestly

Blast radius is the drive's database. Not the audio, not the hardware.

| # | Failure | Severity | Mitigation shipped |
|---|---|---|---|
| 1 | Rekordbox says "Device Library is corrupted", user accepts the offer to delete → all playlists gone | **Worst realistic** | Dual on-drive backups, `WHATTODOIFTHISWENTTOSHIT.txt` telling them to say **no** |
| 2 | Player silently ignores or truncates the library | High | Read-back verification after write |
| 3 | Structurally valid but wrong bookkeeping — our parser round-trips it, firmware rejects it | **Insidious** | Byte-diff test; `free_size`/`used_size`/`num_rows` all maintained |
| 4 | Drive yanked mid-write | High | `createWritable()` swap-file semantics; recovery note says eject properly |

**Mitigations in the shipped commit pipeline** (`src/lib/usb/commit.ts`):

1. Permission → 2. Read → 3. **Dual verified backup (hard gate)** → 4. Build in memory →
5. Re-parse the in-memory image → 6. Write → 7. **Read back off the drive, compare SHA-256
and re-parse** → 8. Refresh recovery note.

If step 6 or 7 fails, the backup from step 3 is **restored automatically** before the error
surfaces. There is no path that leaves the drive in a state we did not verify or roll back.

Worth internalising: the CDJ-3000 fw 3.30 incident was **AlphaTheta's own first-party
stack** breaking libraries on this exact seam. Ship it opt-in and reversible.

---

## 6. Interfacing with the rekordbox database generally

Three surfaces, very different difficulty:

**Desktop `master.db` (rekordbox 6/7)** — SQLCipher SQLite.
[`pyrekordbox`](https://github.com/dylanljones/pyrekordbox) reads *and* writes it, so it is
proven. Caveats: rekordbox must be closed; you must maintain `rb_local_usn` bookkeeping or
you corrupt cloud sync. In a browser you would need a SQLCipher-capable WASM build
(wa-sqlite with SQLCipher, not plain `sql.js`) plus File System Access to the user's
Application Support directory.

**rekordbox XML** — the sanctioned interop path. Tracks, cues, beatgrids, playlists,
importable by rekordbox. Zero legal or corruption risk. **This app now exports it**
(`src/lib/export/exporters.ts`). Any third-party tool should treat this as its primary
read/write channel.

**USB export** — a PDB writer plus an ANLZ writer. The PDB half is documented; the ANLZ
half (`PIONEER/USBANLZ/**/ANLZ0000.DAT/.EXT`) is where quality lives. No ANLZ means tracks
play but show no waveform, no beatgrid and no hot cues.

### Note on rickordbox / djOS

[rickordbox](https://github.com/CarlosFranzetti/rickordbox) claims "10× faster than
rekordbox" by skipping analysis and delegating it to the hardware. **CDJs do not analyse
tracks.** An export with no ANLZ files gives you a library that plays but is not usable for
performance. Getting it to "actually work" means writing ANLZ — that is the real cost, not
the PDB.

**Legal footing:** AlphaTheta's EULA prohibits reverse engineering, and the Device Library
Plus key is a decryption key for their format. Reading your own data is defensible;
distributing a tool built on an extracted key is greyer. Worth a deliberate decision.

---

## 7. Sources

- [crate-digger](https://github.com/Deep-Symmetry/crate-digger) — the PDB Kaitai spec
- [Deep Symmetry DJ Link analysis](https://djl-analysis.deepsymmetry.org/rekordbox-export-analysis/exports.html)
- [rekordcrate](https://github.com/Holzhaus/rekordcrate) — Rust reader
- [pyrekordbox](https://github.com/dylanljones/pyrekordbox) — Python reader/writer
- [rex](https://github.com/kimtore/rex) — Go PDB writer, "do not use on a live gig"
- [OneLibrary encryption notes](https://gist.github.com/0xdevalias/b803476793b56f7c45e6361799168eb0)
- [Lexicon on Device Library Plus](https://www.lexicondj.com/blog/everything-you-need-to-know-about-device-library-plus-and-more)
- [MusicTech on the CDJ-3000 fw 3.30 bug](https://musictech.com/features/pioneer-dj-cdj-3000-firmware-bug-jaguar-mojaxx/)
- [Pioneer DJ community: Device Library is corrupted](https://forums.pioneerdj.com/hc/en-us/community/posts/360039933511-Device-Library-is-corrupted)
