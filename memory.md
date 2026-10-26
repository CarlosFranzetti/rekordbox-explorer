# memory.md — the full context dump

**What this file is.** Everything a cold reader needs to pick this project up, written out
rather than summarised. `memorystate.md` is the *curated* decision record — tight, edited,
the version you cite. This is the raw working context behind it: what was actually tried,
what failed first, and which beliefs were wrong before they were right.

If you only read one file, read `memorystate.md`. Read this one when something there looks
arbitrary and you want to know why.

**Last dumped:** 2026-10-26

---

## 1. What this project is, in one paragraph

A DJ's library lives on a USB stick formatted by rekordbox, in a binary database called
`export.pdb`. To look inside it you normally install a 1 GB application. This reads the
stick directly in the browser — the whole binary parser runs client-side, there is no
server, and nothing is ever uploaded. It now also auditions the audio, checks which CDJs
will read the drive, and recovers a library from a stick that was yanked mid-write.

## 2. The two branches, and why there are two

| Branch | What | Deploys |
|---|---|---|
| `main` | The **viewer**. Read, browse, audition, check compatibility, recover, export. | Production, auto-promotes |
| `for-later` | The viewer **plus the playlist editor** — PDB writer, dual on-drive backups, 8-step commit pipeline with rollback, device registry. | Branch preview alias |

The editor was built, merged as PR #9, deployed — and the user hit a problem in production
and used Vercel Instant Rollback. **The specific symptom was never captured.** That single
missing console error is still the largest unknown in the project, and it is why the editor
is parked rather than shipped. `memorystate.md` §2 ranks the suspects.

Everything built since the rollback has been landed on **both** branches, so `for-later`
never drifts into a stale fork. The **documentation** is kept byte-identical on purpose —
it makes the periodic sync a `diff` rather than a merge.

The **code** is deliberately not identical: `for-later` is a superset. That gap is a live
hazard, and it has bitten twice. A shared doc that describes the code describes *one*
branch's code, and on 2026-10-26 an audit found `SECURITY.md` and `PRIVACY.md` on `main`
documenting a parser, an export pipeline, a device registry and a write-permission prompt
that only exist on `for-later` — including a CSP claim that was false for `main`. **Any
claim in a shared doc that differs by branch must say which branch it means.**

**The branch rule:** write path, editor, backups, device registry → `for-later`. Low-risk
viewer work and docs → `main`.

## 3. The corrupt USB — the most useful thing in this repo

A real drive was pulled without ejecting. This is the full diagnosis, because the shape of
the failure is what the whole recovery design is built on.

All three rekordbox databases stopped at **exactly 32 KB**:

| File | State |
|---|---|
| `EXPORT.PDB` | 8 of 184 declared pages |
| `exportExt.pdb` | 5 real pages of 21 |
| `exportLibrary.db` | extended to its full 131 pages, **122 of them literally all zeros** |

`playlist_tree` starts at page 15 and `playlist_entries` at page 17 — both past the 32 KB
cutoff. So the playlists were not *damaged*, they were **absent**. Nothing to repair.

`Engine Library/Database2/m.db` — Denon's database, sitting on the same stick — was **616
of 620 pages, 99.4% intact**, because Engine had last written it four days earlier and was
not open when the drive vanished. Everything came back from it: **52 playlists, 721 tracks,
1,391 entries, zero orphans.**

The clincher that these were the same library: every Engine track carries
`pdbImportKey = 7839`, which is exactly the `sequence` in the damaged `export.pdb`.

### The rule this produced

> **A drive rarely loses every library at once.** They are written at different times by
> different software. Whichever was open when the drive vanished loses its unflushed pages;
> the others are untouched. **Recovery is a search problem, not a repair problem.**

### Techniques now in `src/lib/recovery/`

- **Header-vs-size check.** PDB: `next_unused_page × len_page` vs actual length. SQLite:
  page count at header offset 28. This is what catches truncation.
- **All-zero page census.** Separates *unwritten* from *damaged*. The distinction changes
  the advice completely, so `assess.ts` draws the line and keeps it drawn.
- **Journal / `-wal` handling.** A **zero-length** `-journal` means the transaction
  committed and nothing is pending — that was the case here. A non-empty one means a write
  was in flight. Neither can be replayed in a browser, so we say so rather than silently
  reading half a transaction.
- **OneLibrary: decrypt first, then assess.** Encryption hides blank pages entirely.
- **Engine DJ as an alternate source.** The key move.
- **Score by playlists recovered, then tracks.** Playlists are the thing that cannot be
  rebuilt by re-scanning a folder of audio.

### Two things deliberately not done

**No synthesised `export.pdb`.** The user asked for fixed Pioneer files to write back to
the stick. I declined once, with a reason: it needs every DeviceSQL string offset correct
and there is no CDJ here to validate against. A database that looks fine and fails in a
booth is worse than no database. The output is **rekordbox XML**, which you import and let
rekordbox write both databases properly. Do not "improve" this without hardware to test on.

**Recovery never writes to the drive.** Read-only, always.

## 4. OneLibrary (the format for newer gear)

AlphaTheta shipped this in October 2025 for CDJ-3000X, XDJ-AZ, OPUS-QUAD, OMNIS-DUO and
CDJ-3000 fw 3.15+. It is SQLCipher-encrypted SQLite at
`PIONEER/rekordbox/exportLibrary.db`, written *alongside* the legacy `export.pdb`.

The project record used to say this was out of reach. **That was wrong and is now
reversed.** Reading and playlist writing both work, in the browser, with no WASM:

- SQLCipher 4: AES-256-CBC **no padding**, page size 4096, **reserve 80** (16-byte IV +
  64-byte HMAC-SHA512), PBKDF2-HMAC-SHA512 at **256,000 iterations**, salt = the first 16
  bytes of the file.
- **The passphrase is a string, never raw hex.** This is the single easiest thing to get
  wrong, and it fails as "wrong key" rather than as a type error.
- Every primitive is in WebCrypto. No SQLCipher-in-WASM build is needed. The belief that
  one was is what blocked this for months.

A **forgiving b-tree walker** reads the SQLite, never a real SQLite engine. `sqlite3`
rejects a truncated file outright with `database disk image is malformed`; the walker reads
whatever pages survived. That is precisely what made the recovery above possible.

**The WAL trap:** an unflushed `-wal` means the `.db` on its own is stale. Surface it.

## 5. The audition player

The user asked for a player "like the one in RA-NYC" to audition tracks off the stick. The
interesting part turned out not to be the transport — it was the formats.

### Chrome cannot play AIFF. At all.

Verified in headless Chromium, both routes: `canPlayType('audio/aiff')` returns `""` and
`decodeAudioData` throws `EncodingError`. Safari decodes AIFF happily — and has no folder
picker. So on the **one browser with the File System Access API this app needs**, the
format most of a vinyl-leaning library is stored in is unplayable.

AIFF is uncompressed PCM in a chunked container, so `src/lib/audio/aiff.ts` decodes it
directly. Arithmetic, not a codec. That is the difference between "auditioning does not
work for most of your library" and "it works". **Do not delete it as redundant.**

### Capability is probed, never hardcoded

Which formats fail varies by **build**, not just by browser: Chrome ships AAC, a Chromium
compiled without proprietary codecs does not, and *both report the same empty string* from
`canPlayType`. A hardcoded extension list is therefore wrong on somebody's machine, and the
failure mode is **silence** — the worst possible way to be wrong. `formats.ts` probes once
per extension, caches, and resolves each file to `native`, `decode`, or `unsupported`.

| Format | Route |
|---|---|
| MP3, FLAC, ordinary WAV | native |
| AIFF | our decoder, always |
| WAV 24-bit / 32-bit float / `WAVE_FORMAT_EXTENSIBLE` | our decoder when the browser refuses |
| AAC / M4A | native where the build has it |
| ALAC | **unsupported** — named plainly, with the note that it still plays on a CDJ |

### Traps that cost real time

- **8-bit AIFF is signed; 8-bit WAV is unsigned.** Swap them and you get a loud DC offset,
  not a visible bug. Both directions are pinned by tests.
- **Chunk headers declare the *original* length.** A file rescued off a dying drive is
  shorter than it claims. Both decoders clamp to `bytes.length`. This was caught by the
  truncation test, not by reading the code.
- **`WAVE_FORMAT_EXTENSIBLE`** hides the real format tag at `body + 24` inside a GUID; the
  visible tag is `0xFFFE` for everything.
- **A buffer source cannot be paused.** `AudioBufferSourceNode` is one-shot, so position is
  tracked with `startedAt`/`offset` and a fresh node is created on resume.
- **`getChannelData().set()`, not `copyToChannel()`** — the latter trips TypeScript's
  `Float32Array` variance under this config.

### Layout, each decision made against a screenshot

- Contents capped at `max-w-3xl`; the **surface** still spans the viewport so it reads as a
  bar. Uncapped, the seek control stretched past 2000px on a wide monitor, where one pixel
  is a fifth of a second — precision nobody aims for.
- A floating bordered card, inset from all four edges: 12px + safe-area on a phone so it
  clears the home indicator, 8px on desktop.
- 7px track, 18px handle ringed in the bar's own background colour. On a thick track a
  flush thumb reads as a bulge in the fill rather than something to grab.
- **Padding on both sides of the seek row.** The handle plus its ring nearly fills its own
  row; flush against the transport, a thumb aiming for the scrubber hit the play button.
  Measured: 23px above the track, 20px below, ring 11px clear of the buttons.
- `--player-h` is measured **to the bottom of the viewport**, not from the bar's height —
  the bar floats, so the table must clear the gap too — and re-published on resize.

`preview.html` + `src/preview-main.tsx` render the real `TrackTable` and `PlayerBar` against
ten fixture tracks, so all of this is checkable without a USB. Vite only builds
`index.html`, so the harness never ships.

## 6. Deployment reality

Production is `rekordbox-explorer.vercel.app`. Project `prj_wy7F1HyK98thD0ggXxb8JaHMAkWV`,
team `team_2sVeVCDGjXW2eMc1O6Qr78l5`.

**The Instant-Rollback trap, and how it was finally caught.** For a long stretch after the
rollback, pushes to `main` built, went `READY`, and **were never promoted** — Instant
Rollback holds the production alias on the deployment it rolled back to, and nothing on the
deployment page says so. Every push looked successful and changed nothing for users.

That pin has since been lifted and pushes auto-promote again. The lesson worth keeping:

> The deployment record **listed the production alias while the pin was still in force**,
> so the status field was never evidence either way. The check that settles it is fetching
> a hashed asset from the live domain and looking for something only the new build
> contains.

## 7. Known blockers that are not fixable from inside this container

Both were re-tested on 2026-09-10 and are structural, not permission problems.

**Branch deletion returns HTTP 403.** Proven not to be branch-specific: pushing a brand-new
branch succeeded and deleting that same branch seconds later failed with the identical 403.
The git proxy refuses ref deletion categorically, before the request reaches GitHub. The
GitHub MCP server has `create_branch` and `list_branches` but **no delete-branch tool**, and
there is no `gh` CLI or direct API access. Three routes, none with ref deletion in it.

Two branches are waiting on a human with a trash icon: `claude/rekordbox-playlist-export-7wndye`
(stale, superseded) and `zz-delete-probe` (which I created to prove the above, and could
then not remove — worth knowing that experiment has a cost).

**Web Analytics cannot be enabled from here.** `get_web_analytics` returns
`404 Web Analytics not found`. The Vercel MCP surface can pause, unpause and set deployment
protection, but has no analytics toggle. `<Analytics />` is already mounted in the code on
both branches, so the moment a human flips it on in the dashboard, beacons start counting —
no redeploy needed.

## 8. Standing constraints

Violating any of these has broken something before.

1. **Never reintroduce a remote icon URL.** The originals were hotlinked from a third-party
   bucket. Everything in `public/` is local now.
2. **No `console.log` in shipping paths.** The old parser emitted one per album row.
3. **Recovery is read-only, and its only output is rekordbox XML.**
4. **The user's library data is never committed.** This is a public repo. Real `m.db` and
   `export.pdb` files were used in a throwaway local test to verify the recovery code, and
   that test was deleted. Every committed fixture is synthetic and reproduces the same
   failure *shape*.
5. **Prefer degrade-gracefully over throw** in the parser. Over-strict validation is a prime
   suspect for the un-diagnosed rollback.
6. **Writes append only**, never without a verified backup, always verified after, always
   rolled back on failure. Six invariants, each pinned by a test — `CLAUDE.md`.

## 9. Error messages are read by a DJ ten minutes before doors

Say what happened, what state the drive is in, and what to do. Never make someone guess
whether their library survived. This is why a compressed AIFC says *"the track itself is
fine — only previewing it in the browser is not possible"* rather than "decode error".

## 10. Where to look

| File | What |
|---|---|
| `memorystate.md` | The curated decision record. **Start here.** |
| `roadmap.md` | What is missing, and which branch each item belongs on |
| `database.md` | Which databases we read/write and the case for and against each |
| `research_playlistHelp.md` | Full `.pdb` format reference |
| `trd.md` · `prd.md` | Architecture · product scope |
| `CLAUDE.md` | The rules an agent must not break |
