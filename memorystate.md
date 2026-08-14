# Memory State

Everything a cold reader — human or agent — needs to pick this project up without
re-deriving it. **Read this first.**

**Updated:** 2026-08-09 · **Live version:** 0.2.x (viewer) · **Parked version:** 0.3.0 (editor)

---

## 1. Where things stand right now

| | |
|---|---|
| **Production** | `rekordbox-explorer.vercel.app` — the **viewer**, plus the new icon set |
| **`main`** | `53fc8af` tree (stable viewer) + revert commit + branding commit |
| **`for-later`** | `30d7ec3` — the full playlist-**editor** release, parked, unmerged |
| **PR #9** | Merged, then rolled back. History intact. |

### How we got here

1. The editor release (PDB writer, backups, commit pipeline, device registry, exports,
   parser rewrite, 155 tests) was built, merged as PR #9 (`30d7ec3`), and deployed.
2. Vercel built it fine — `dpl_CZJ44hd6` went `READY`.
3. **The user hit issues in production and used Vercel Instant Rollback.** The specific
   symptom was never captured. This is the single biggest open question in the project.
4. To match git to reality, `main` was reverted **forward** to the `53fc8af` tree
   (force-push is blocked by a repo ruleset, and a forward revert is better anyway —
   auditable, and re-landing is one `git revert`).
5. The Lovable scaffold icons were replaced with the hard-drive-in-a-circle mark.

### ⚠️ Instant Rollback pins the production alias

New deployments build and go `READY` but **do not get promoted**. After pushing to `main`
you must click **Promote to Production** on the deployment, or run
`vercel promote <deployment-url>`. Symptom that you forgot: the live URL returns a large
`age:` header and stale HTML while a newer deployment sits `READY`.

---

## 1b. Deployment topology

Verified 2026-08-14 against the Vercel API. Project `prj_wy7F1HyK98thD0ggXxb8JaHMAkWV`,
team `team_2sVeVCDGjXW2eMc1O6Qr78l5`.

| Target | Branch | URL | State |
|---|---|---|---|
| **Production** | `main` | `rekordbox-explorer.vercel.app` | ⚠️ **pinned to the pre-rollback build** |
| **Preview** | `for-later` | `rekordbox-explorer-git-for-later-carlosfranzettis-projects.vercel.app` | ✅ auto-builds, `READY` |

Three git branches exist on the remote:

| Branch | Role |
|---|---|
| `main` | Stable viewer. Deploys to production (when promoted). |
| `for-later` | Parked editor release. Auto-deploys to the branch preview alias above. |
| `claude/rekordbox-playlist-export-7wndye` | Stale working branch, superseded by the two above. Safe to delete. |

**`for-later` needed no configuration to get a preview URL.** Vercel builds a preview for
every pushed branch by default, and gives each branch a stable alias of the form
`<project>-git-<branch>-<owner>.vercel.app` that always points at that branch's newest
build. Push to `for-later` and the preview updates itself.

### Public access: production is open, every preview is gated

The project has **Vercel Deployment Protection** on:

```
ssoProtection:      { enabled: true, deploymentType: "all_except_custom_domains" }
passwordProtection: disabled
trustedIps:         disabled
custom domains:     none — only *.vercel.app hostnames
```

Do not read `all_except_custom_domains` literally — it does **not** mean "everything that
isn't a custom domain is gated." Probing all three hostnames settles what it actually does:

| Hostname | Response |
|---|---|
| `rekordbox-explorer.vercel.app` — the production domain | `200`, full HTML, `x-vercel-cache: HIT`, no auth challenge |
| `rekordbox-explorer-git-main-…vercel.app` — branch alias | `302 → vercel.com/sso-api`, `x-robots-tag: noindex` |
| `rekordbox-explorer-git-for-later-…vercel.app` — branch alias | `302 → vercel.com/sso-api`, `x-robots-tag: noindex` |

That is exactly Vercel's **Standard Protection**: the *production domain* is exempt;
deployment URLs, branch aliases and previews are all gated. The `.vercel.app` production
alias counts as exempt alongside any custom domain.

So: **anyone can use the live app. Nobody outside the Vercel team can open the preview,
and the preview will never be indexed** — which is the right default for a branch carrying
an un-diagnosed rollback.

To share the preview with a specific person without turning protection off, use Vercel's
per-deployment **Share** link (it mints a `_vercel_share` token) rather than flipping the
project setting.

Sanity-check any of this in a private/incognito window — one second, no API archaeology.

### Analytics: script present, collection off

`<Analytics />` from `@vercel/analytics/react` is mounted in `src/App.tsx` on **both**
branches, and `vitals.vercel-insights.com` is allowed in the `connect-src` CSP in
`vercel.json`. So the beacon fires from both deployments.

But **Web Analytics is not enabled on the Vercel project** — the API returns
`404 Web Analytics not found`. Beacons are sent and dropped; no data is being retained for
either deployment. Enabling it is a dashboard action with no API/MCP equivalent:
**Vercel → Project → Analytics → Enable**. It covers production and preview together;
there is no per-deployment switch.

Note the interaction with protection: once enabled, production would record real public
traffic, but the previews would only ever record logged-in team members — so preview
numbers will look near-empty by design, and that is not a bug.

---

## 2. The rollback: ranked suspects

Nobody captured the error, so this is analysis, not diagnosis. Ranked by how well each
explains "built clean, passed 155 tests, smoke-tested green, still broke for a real user".

**1. No React error boundary (most likely amplifier, whatever the trigger).**
`src/App.tsx` on `for-later` has no error boundary. Any component throwing during render
gives a **blank white page** with no message. That is exactly what "everything is broken"
looks like. Even if the trigger is one of the below, this is what turned it into a
catastrophic symptom instead of a visible error. **Fix this first regardless.**

**2. Parser got stricter and now throws where the old one coped.**
`src/lib/pdb/structure.ts` `readFileHeader()` throws when
`view.byteLength % lenPage !== 0`. The old parser never required the file size to be an
exact multiple of the page size. A real `export.pdb` with any trailing bytes now fails to
load **entirely**, where before it loaded fine. The old parser also allowed up to 1000
tables; the new one caps at 64. Verified by reading the code; **not** verified against a
real-world file, because we have never tested against one — every test uses synthetic
fixtures we generated ourselves, which are page-aligned by construction. **This is the
most plausible functional trigger and the tests are structurally blind to it.**

**3. `walkTablePages` stops on `page.type !== table.type`.**
Stricter than the old chain-walk. If a real chain interleaves pages, rows silently vanish
— a partial library rather than a crash.

**4. IndexedDB in the device registry.**
`rememberDevice()` runs on *every* successful load from `useRekordbox.ts`. The call is
`void rememberDevice(...).catch(() => {})` so a rejection is handled — but `openDb()`
caches `dbPromise` forever, so a first failure poisons it for the session, and
`onblocked` is unhandled (a second tab with an older schema hangs the open promise
rather than rejecting). Safari private mode is the classic environment for this.
**Analysed, plausible, not confirmed.**

**5. Stale localStorage settings.** Investigated and I believe this is **fine** —
`hydrate()` in `useSettings.ts` spreads over `DEFAULT_SETTINGS` and re-validates arrays
and numbers, so an old `{colorScheme, fontSize, hiddenColumns}` object upgrades cleanly.
Ruled out unless evidence says otherwise.

**6. `crypto.subtle` unavailable.** Only reachable on write/backup paths, not on load.
Would not break plain browsing. Low.

### 2026-08-14 review round — three suspects eliminated

A second independent review traced every call path and **narrowed the list above**. The
headline correction:

> **The page-alignment throw is caught.** `useRekordbox.ts` wraps every parse entry point
> — `selectFolder`, `reload`, `handleFileInput`, `performFullScan` — in `try/catch` and
> sets `status: 'error'`. So suspect #2 renders a visible error card, **not** a blank
> page. It is still a real regression (the app refuses files the old parser opened), but
> it cannot by itself produce the catastrophic symptom.

Also established, with call-path evidence:

- **Suspect #4 (IndexedDB) is ruled out as a cause of "library won't display."**
  `setStatus({ type: 'valid', ... })` runs *before* `rememberDevice()` is called, and the
  call is `void`-ed with a `.catch`. Success, rejection, or an indefinite hang cannot
  block or crash library display. The `dbPromise`-caches-a-rejection bug is real but
  silent and session-scoped. `onblocked` is unreachable until `DB_VERSION` bumps past 1.
- **Suspect #5 (localStorage) confirmed ruled out.** Object spread never overwrites a
  missing key with `undefined`; every new settings field keeps its default.
- **Suspect #6 (`crypto.subtle`) confirmed ruled out** — write paths only.
- **Suspect #3 got more interesting, not less.** `walkTablePages` returning on a type
  mismatch ends the *whole generator*, discarding every remaining page in the chain. The
  old parser skipped the bad page and kept walking. On a well-used drive with rekordbox's
  page-reuse mechanism, this yields a **silent partial library** — no error at all, just
  missing tracks. That is a harder symptom to describe than a crash, which fits "the
  specific symptom was never captured" better than anything else on the list.
- **No uncaught render-time throw was found anywhere in the codebase.** The error boundary
  is still the correct first fix, but as insurance against future bugs rather than as the
  explanation for this one.

Revised bet: **#2 or #3**, with genuinely low confidence in either. The honest conclusion
is unchanged and now doubly evidenced — this cannot be resolved without the original
console error or a real `export.pdb`.

### New defects found this round

- **`recovery-note.ts:115` lies about the Rescue tab.** The on-drive
  `WHATTODOIFTHISWENTTOSHIT.txt` promises Rescue "scans the whole drive for any
  recoverable database and offers to put it back." The actual tab
  (`BackupsDialog.tsx:411`) is static advice text with no scan action. This is the one
  document a DJ reads mid-incident with no internet. Fix the text or build the feature.
- **`console.log` per album on `main`** (`rekordbox-parser.ts:647`) — violated this repo's
  own rule, fired once per album row on every load. **Fixed 2026-08-14.**
- **Dead `rating > 255` check** on a `getUint8` — impossible condition dressed as a
  validation. Harmless, misleading.
- **`main` still carries the Lovable scaffold's bloat**: `NavLink.tsx` (zero imports),
  ~20 unreferenced shadcn components, 24 unused dependencies (including
  `@tanstack/react-query` with zero `useQuery` calls), and an eager top-level `jspdf`
  import (~400 KB in the main chunk). `for-later` already trimmed all of it.

### Security audit — clean

A separate audit of `for-later` covering untrusted binary parsing and write-path safety
found **no exploitable vulnerabilities**. Every `DataView` read is bounds-checked; every
chain walk has a `visited` set and a page cap; allocation is capped at four levels;
CSV/M3U8/XML/filename/print-HTML output is escaped with tests proving it; all six write
invariants are enforced with a hard gate and automatic rollback; no secrets; CSP has no
`script-src 'unsafe-inline'`; privacy claims verified (nothing but Vercel page views
leaves the browser).

### What to do about it

Before re-landing `for-later`: add an error boundary, relax the page-alignment check to a
warning, make `walkTablePages` skip-and-continue instead of truncating, and **test against
a real `export.pdb`** — the one gap no amount of synthetic fixture work closes. If the
user can supply the actual console error, most of this list collapses to one item.

---

## 3. Decisions, with reasons

| Decision | Why | Reversible? |
|---|---|---|
| **Additive PDB writes only** — append new pages, never overwrite | Original bytes provably survive; a failed write leaves recoverable data | Yes, but don't |
| **Playlist tables only** (types 7, 8) | 20-byte + 12-byte rows, no shared string tables. Metadata edits touch tables every other row references | Deliberately deferred |
| **Two backup vaults in two directory trees** | Losing one folder must not lose the history | No — core guarantee |
| **Manifest never trusted for listing** | A corrupt `manifest.json` is exactly when listing must still work | No |
| **4-byte row alignment** | Format targeted 16-bit hardware; costs bytes, removes a risk class | Yes |
| **Sample `page_flags` from existing pages** | Both `0x24` and `0x34` occur; mimic what rekordbox did on *this* drive | Yes |
| **Don't write Device Library Plus** | Key known, schema not, no working precedent, AlphaTheta can rotate it | Revisit if schema is documented |
| **Pick `mode:'read'`, upgrade on demand** | Read-only visitors should never see a write prompt | Yes |
| **IndexedDB for the device registry** | 10 libraries × 5k tracks blows localStorage's 5 MB | Yes |
| **Dropped `@tanstack/react-query`** | Zero `useQuery` calls existed. No network to fetch from | Yes |
| **Lazy-load jsPDF** | 400 KB for a feature most sessions never use | Yes |
| **Revert forward, don't force-push** | `main` is protected; forward revert is auditable and re-landing is one command | n/a |
| **Local icon assets** | The old favicon/og image were hotlinked from Lovable's bucket — could vanish any time | n/a |

---

## 4. Bugs found and fixed (in the parked release)

1. **Backup ID collision.** Second-granularity timestamps meant a manual backup
   immediately followed by a pre-write backup overwrote each other. Now millisecond
   timestamps + a collision suffix. *Caught by a test, not by review.*
2. **`DataView.byteOffset` ignored** in the old string reader — latent, would break any
   future chunked parsing.
3. **Off-by-one** in long-form DeviceSQL string bounds (`>=` where `>` was meant).
4. **Album parsing was four stacked guesses** with a `console.log` per album firing in
   production. Replaced with the documented layout (`subtype & 0x04` → u16 at `0x16`,
   else u8 at `0x15`).
5. **No-op validations** — `rating > 255` on a `getUint8`, `length > 65535` on a
   `getUint16`. Removed.
6. **Mobile layout was broken.** The resizable two-pane shell rendered unconditionally,
   so a phone got a squeezed sidebar and a 1px mouse-only drag handle. Now a Sheet
   drawer below 768 px.
7. **39 unused shadcn components + 24 unused dependencies** shipped in the tree.
   `no-unused-vars` was disabled, so nothing caught them.

---

## 5. Landmines

- **`empty_candidate`, `index_shift`, and "strange" pages (`page_flags & 0x40`)** remain
  undocumented. Not known to matter for playlists. Not proven irrelevant.
- **A rekordbox re-export wipes device-only playlists.** Expected; users will be surprised.
- **CDJ-3000 firmware 3.30** prioritised OneLibrary and was pulled by AlphaTheta. If it
  returns, legacy-only drives stop working on that model.
- **Vercel rollback pins the alias** — see §1.
- **`main` is protected**; no force-pushes. Plan forward-only.
- **All testing is synthetic.** No real `export.pdb`, no real CDJ. See §2.

---

## 6. Test infrastructure (on `for-later`)

- **`src/test/fixtures/pdb-fixture.ts`** builds synthetic `.pdb` images. Written
  *independently of the writer on purpose* (tight packing vs. the writer's 4-byte
  alignment) so round-trip tests cross-check two implementations. **Do not refactor it to
  share the writer's encoding.**
- **`src/test/fixtures/memory-fs.ts`** is an in-memory File System Access API with fault
  injection — `failWritesMatching`, `corruptWritesMatching`, `failMkdirMatching`. This is
  how "the drive corrupts a write mid-commit" became a unit test.

155 tests across 7 suites. **Their blind spot: they only ever see files we generated.**

---

## 7. Key facts worth not re-deriving

- **PDB page header**: `0x08` type, `0x0C` next_page, `0x18` num_row_offsets (b13) +
  num_rows (b11), `0x1B` page_flags, `0x1C` free_size, `0x1E` used_size. Heap at `0x28`.
- **Row index** builds *backwards* from page end in `0x24`-byte groups of 16.
- **Playlist rows**: tree = `parent_id, _, sort_order, id, raw_is_folder, name` (20 B +
  string). Entry = `entry_index, track_id, playlist_id` (12 B fixed).
- **Player split**: CDJ-2000/3000(≤3.22)/XDJ read `export.pdb`. OPUS-QUAD, OMNIS-DUO,
  XDJ-AZ, CDJ-3000X need Device Library Plus.
- **The bridge**: rekordbox 6.6.11+ converts an on-device legacy library to Device
  Library Plus. That is how playlists written here reach newer gear.
- **Brand colours**: primary `hsl(200 100% 50%)` = `#00AAFF`; background
  `hsl(220 15% 8%)` = `#111317`.
- **Vercel**: project `prj_wy7F1HyK98thD0ggXxb8JaHMAkWV`, team
  `team_2sVeVCDGjXW2eMc1O6Qr78l5`.

---

## 8. Open items

1. **Get the actual rollback error.** Everything else is guessing.
2. Add an error boundary; relax the page-alignment throw. (`for-later`)
3. Test against a real `export.pdb` and real CDJ hardware.
4. Promote the current deployment (needs a human click).
5. Set GitHub topics — see `docs/TOPICS.md`.
6. Upload `public/og-image.png` as the GitHub social preview (separate setting; it does
   not read `og:image`).

---

## 9. Vision context

This is the browser tier of something larger. **rickordbox** is the desktop ambition;
**djOS** is the umbrella; **RA-NYC** is the events/social side — locally moderated by
appointed ambassadors, suggesting contacts and events to visiting DJs, eventually routing
tours from attended-events history + Discogs + actual USB contents.

The shared primitive already exists: **the device registry** knows what is on which drive.

Note on rickordbox: its README claims "10× faster than rekordbox" by skipping analysis
and delegating it to the hardware. **CDJs do not analyse tracks.** An export with no ANLZ
files plays but shows no waveform, no beatgrid, no cues. Writing ANLZ is the real cost of
"actually works", and it is not small.

The through-line: **your library, your drives, your history — local-first, yours.**
