# The Database Question

Should this project read and write Pioneer/AlphaTheta's databases at all — and if so,
which ones? The case for, the case against, and where each stands today.

Format mechanics live in `research_playlistHelp.md`. This is the decision record.

---

## The three databases

| | What | Where | Encrypted | Our stance |
|---|---|---|---|---|
| **`export.pdb`** | DeviceSQL, on the USB. What CDJs read. | `PIONEER/rekordbox/export.pdb` | No | ✅ **Read + write playlists** |
| **`exportExt.pdb`** | MyTag extension | same folder | No | ✅ Read only |
| **`exportLibrary.db`** | Device Library Plus / OneLibrary. SQLite. | `PIONEER/DeviceLibraryPlus/` | **SQLCipher** | ❌ Neither, yet |
| **`master.db`** | Desktop rekordbox 6/7 collection | App Support | **SQLCipher** | ❌ Out of scope for a browser |

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

## 3. Device Library Plus / OneLibrary — reading

**For:** Without it, a drive exported for an OPUS-QUAD shows as unreadable, which is
increasingly the default for new hardware. The SQLCipher key has been recovered and is
public (base85 decode → XOR → zlib inflate), shared across all devices, not machine-bound.
`pyrekordbox` and `onelibrary-connect` read it today. Reading your own data is defensible.

**Against:** SQLCipher-in-WASM is a heavy dependency. The schema is undocumented, so
column meanings are guesswork. AlphaTheta can rotate the key in any firmware release and
the feature dies. And shipping a decryption key for someone else's format is a step beyond
parsing an unencrypted one — their EULA prohibits reverse engineering.

**Verdict: worth doing eventually, read-only, permanently.** Users currently get a clear
message explaining the situation and pointing at rekordbox's own conversion, which is an
honest answer that costs nothing.

**State: not started. P3 on the roadmap, `for-later`.**

---

## 4. Device Library Plus — writing

**For:** It would make the app work on current hardware without a rekordbox round-trip.

**Against:** The schema is undocumented; **nobody has demonstrated a working third-party
writer**; there is no way to validate output short of owning the hardware; the key can
rotate; and the blast radius is the same gig-night failure as above, with none of the
mitigations, because we could not even verify what we wrote.

**Verdict: no. Not "later" — no.** The bridge that already works is telling users to plug
the drive into rekordbox 6.6.11+, which converts the on-device legacy library. Their
playlists carry over. That is a one-step manual workaround versus an unbounded risk.

**State: explicitly out of scope.**

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
   what you meant, do not write it. This alone rules out Device Library Plus.
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
