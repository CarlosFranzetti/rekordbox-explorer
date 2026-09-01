# The Database Question

Should this project read and write Pioneer/AlphaTheta's databases at all — and if so,
which ones? The case for, the case against, and where each stands today.

Format mechanics live in `research_playlistHelp.md`. This is the decision record.

---

## The databases on a stick

| | What | Where | Encrypted | Our stance |
|---|---|---|---|---|
| **`export.pdb`** | DeviceSQL, on the USB. What CDJs read. | `PIONEER/rekordbox/export.pdb` | No | ✅ **Read + write playlists** |
| **`exportExt.pdb`** | MyTag extension | same folder | No | ✅ Read only |
| **`exportLibrary.db`** | OneLibrary (was Device Library Plus). SQLite. | `PIONEER/rekordbox/exportLibrary.db` | **SQLCipher** | ✅ **Read**; playlist writing built, not yet shipped |
| **`m.db`** | Engine DJ (Denon). SQLite. | `Engine Library/Database2/m.db` | No | ✅ Read, **for recovery only** — see §5a |
| **`master.db`** | Desktop rekordbox 6/7 collection | App Support | **SQLCipher** | ❌ Out of scope for a browser |

The fourth row is the one people are surprised by, and it is the reason a drive that
looked dead came back — a stick usually carries more than one library, written at
different moments.

---

## 1. `export.pdb` — reading

**For:** It is the only way to see what is on a stick without installing a 1 GB
application. The format is thoroughly reverse-engineered (Deep Symmetry's crate-digger
Kaitai spec), it is unencrypted, and reading a file you own is uncontroversial. This is
the entire premise of the project.

**Against:** Nothing meaningful. Worst case is a misparse showing wrong metadata.

**State: shipped and live on `main`.**

**Caveat we learned the hard way:** the rewritten parser on `for-later` is *stricter* than
the original and can reject files the old one tolerated — see `memorystate.md` §2. Strict
validation is a virtue for hostile input and a liability for real-world files that are
merely unusual. Prefer "skip the bad row, keep the library" over "throw".

---

## 2. `export.pdb` — writing playlists

### For

- **It is the smallest possible write.** A new playlist is one 20-byte row plus N 12-byte
  rows. No string interning, no track rows touched, no analysis data.
- **It can be made purely additive.** New pages appended past EOF; the only bytes patched
  in the original region are the file header's `sequence`/`next_unused_page`, two table
  pointers, and one chain-graft `next_page`. Every original byte survives — enforced by a
  test that diffs the whole original region.
- **It is verifiable end to end.** Backup → build in memory → re-parse → write → read back
  → compare SHA-256 → re-parse. With automatic rollback on failure.
- **Precedent exists.** VirtualDJ's CDJ export writes this format and people gig on it.
- **The alternative is worse.** Without it, changing one playlist means a laptop, a 1 GB
  install, and a full re-export.

### Against

- **Undocumented fields remain**: `empty_candidate`, `index_shift`, "strange" pages
  (`page_flags & 0x40`). Not known to matter for playlists. Not proven irrelevant.
- **The failure mode is somebody's gig.** "Device Library is corrupted" mid-set, and there
  is no official repair tool — the vendor's answer is reformat and re-export.
- **We have never tested on real hardware.** Everything is synthetic fixtures.
- **Rekordbox can undo it.** A re-export from the desktop app rewrites `export.pdb` and
  device-only playlists vanish.
- **It does not reach newer gear.** OPUS-QUAD, OMNIS-DUO, XDJ-AZ, CDJ-3000X need Device
  Library Plus.

### Verdict

**Do it, but only playlists, only additively, and only behind verified backups.** That is
what `for-later` implements. It stays labelled beta until a real CDJ has read a drive it
wrote.

**State: built, tested against fixtures, parked on `for-later`, never hardware-validated.**

---

## 3. OneLibrary — reading

**Resolved 2026-08-27: implemented, tested, and much cheaper than expected.**

The earlier entry here assumed SQLCipher-in-WASM was required and called it "a heavy
dependency". That was wrong. SQLCipher 4 is AES-256-CBC plus PBKDF2-HMAC-SHA512 plus
HMAC-SHA512 — **every primitive WebCrypto already ships**. Decrypting to a plain SQLite
image and reading that with a pure-JS b-tree walker needs no WASM at all. The whole
layer is ~750 vendored lines with zero dependencies.

Measured: a 25-page real export decrypts in 155 ms.

**The other two objections also fell:**

- *"The schema is undocumented"* — it is documented now. All 22 tables, verified against
  a real rekordbox 7 export, in the OneLibrary spec. Field semantics too: `bpmx100` is
  centi-BPM, `length` is seconds, `rating` is 0–5 here (**not** the PDB's 0/51/…/255).
- *"AlphaTheta can rotate the key"* — still true, and still the standing risk. If it
  happens, OneLibrary reading breaks and the legacy `export.pdb` path keeps working. The
  error message says exactly that rather than blaming the user's drive.

**On shipping the key.** The passphrase is a published constant, identical on every
installation, not machine- or licence-bound, and it protects a file the user already owns
on hardware they already own. Reading your own library is the defensible case; that is
the line this project stays on.

**State: done.** `src/lib/onelibrary/`, 18 tests against a real encrypted export.
Not yet wired into the app's load path — roadmap P7.

---

## 4. OneLibrary — writing playlists

**Reversed 2026-08-27.** The previous verdict was "no. Not 'later' — no", on the grounds
that nobody had demonstrated a working third-party writer and there was no way to validate
output. The first is no longer true and the second was never quite right.

**What changed:** a working encrypt path exists and round-trips, and the schema is known.
More importantly, output *can* be validated without owning the hardware — not against a
CDJ, but against the format itself. `applyPlaylistChanges` decrypts and re-reads its own
output before returning, so a database that would not open never leaves memory.

**What has not changed:** we still have no CDJ to test against. "The file is structurally
valid" is not "the player accepts it". That gap is real and P1's hardware matrix is the
only thing that closes it.

### The append-only invariant does not survive here

This is the important part. The PDB writer's first invariant — a write only ever appends,
so a half-finished write still parses — **cannot hold for SQLite**. Changing one value can
change its serial type, which grows the record, re-lays-out the page, and can split the
b-tree. Editing in place is not meaningfully safer than rebuilding and is much easier to
get wrong.

So OneLibrary writes rebuild the whole file, and invariant 1 is explicitly suspended for
this path. Pretending otherwise would be dishonest. Invariants 2–6 — verified backup
before any write, automatic rollback, snapshot-before-restore, never overwrite a good
library with a damaged backup, never hang on malformed input — all still hold, and carry
more weight because of it.

### Deliberately not doing: cues

rekordbox does **not** populate the `cue` table on export. A test export where one track
carried three hot cues and another carried memory cues, a hot cue and a saved loop had
**zero rows** in `cue` — every one of them lived in the ANLZ files. A writer that fills
the `cue` table and stops produces a device with no cues on it. Cues are an ANLZ problem,
and ANLZ writing is not implemented.

**State: library layer done and tested; not yet routed through `commitPlaylists`, so it
has no backup gate yet. Roadmap P7. Do not ship it to users until it does.**

---

## 5. Desktop `master.db`

**For:** It is the actual collection. `pyrekordbox` proves it is readable *and* writable.
Editing there would propagate everywhere.

**Against:** Not reachable from a browser in any sane way — it lives in Application
Support and needs SQLCipher. Rekordbox must be closed. You must maintain `rb_local_usn`
bookkeeping or you corrupt cloud sync. And the sanctioned interop path already exists.

**Verdict: not in the browser. This is rickordbox's job, if anyone's.**

**State: out of scope here; noted for the desktop tier.**

---

## 5a. Engine DJ `m.db` — read, and only to save a drive

Not a Pioneer database at all: Denon's, at `Engine Library/Database2/m.db`, plain
unencrypted SQLite. It is in this record because a rekordbox stick frequently has one
sitting next to the Pioneer files, and **that is what recovered a real drive.**

**For:** It is written by different software at a different time. When a drive is pulled
mid-write, the database that was open loses its unflushed pages and the others do not —
so the Engine library is often intact when every rekordbox file on the same stick is not.
On the drive this was built against, all three rekordbox databases stopped at exactly
32 KB while `m.db` was 616 of 620 pages, last written four days earlier. Every playlist
came back from it.

`Track.pdbImportKey` is the clincher: it carries the `sequence` from the `export.pdb` the
Engine library was imported from, so you can *prove* the two are the same library rather
than hoping.

**Against:** Nothing, at the scope we use it. It is read-only, it is not encrypted, and no
Pioneer EULA covers it.

**Verdict: read it, for recovery only.** It is a source to rebuild *from*, never a
destination. We do not write Engine libraries and have no reason to.

**State: shipped on both branches** — `src/lib/recovery/engine.ts`. Read with the same
forgiving b-tree walker as OneLibrary, because a real SQLite engine rejects a truncated
file outright and the whole point is reading one that is damaged.

---

## 6. rekordbox XML — the sanctioned path

**For:** AlphaTheta documents it for third-party import. Tracks, cues, beatgrids,
playlists. Rekordbox reads it directly. **Zero corruption risk, zero legal grey area.**

**Against:** It is import/export, not live editing — the user has to do something in
rekordbox. It cannot put a playlist on a stick for tonight.

**Verdict: always support it. It is the safety valve** — whenever a binary write is too
risky, XML is the honest fallback.

**State: export shipped on `for-later`. Import is P5.**

---

## Principles this record encodes

1. **Read freely, write narrowly.** Reading your own data is safe and uncontroversial.
   Writing is where libraries die.
2. **Never write what you cannot verify.** If you cannot read it back and prove it says
   what you meant, do not write it. This used to rule out OneLibrary; it no longer does,
   because the writer decrypts and re-reads its own output before returning. Note what the
   principle still rules out: we can verify the *format*, not that a CDJ accepts it, which
   is why OneLibrary writing is built but not shipped.
3. **Additive beats destructive.** Appending leaves the original recoverable. Overwriting
   does not.
4. **Prefer the sanctioned path when it exists.** XML costs the user a click and costs us
   nothing in risk.
5. **Strictness cuts both ways.** Hard validation protects against hostile input and
   rejects legitimate files. For a *reader*, degrade gracefully. For a *writer*, refuse.
6. **Synthetic tests prove the code matches your model of the format, not that your model
   matches reality.** Only hardware closes that gap.

---

## Legal footing

AlphaTheta's EULA prohibits reverse engineering. Parsing an unencrypted file you own is
defensible; distributing a tool built on an extracted decryption key is greyer. This
project reads the unencrypted format, does not bundle any key, and points users at the
vendor's own conversion tool for the encrypted one. Not affiliated with or endorsed by
AlphaTheta / Pioneer DJ.
