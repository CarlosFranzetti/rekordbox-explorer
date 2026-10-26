# Security

## Threat model

This app has no server, no accounts and no secrets. Two things matter:

1. **`export.pdb` is untrusted input.** It is a binary file the app did not write, and a
   malformed or hostile one must not crash, hang, or exfiltrate anything. The same applies
   to every other binary the drive hands us: `exportExt.pdb`, OneLibrary, an Engine DJ
   database, and the audio files themselves.
2. **Writes are destructive by nature.** The worst realistic outcome is a lost library, not
   a compromised machine — so the safety work lives in `src/lib/usb/`, not here.

> **Which branch this describes.** `main` is the read-only viewer; `for-later` adds the
> playlist editor. Sections below that cover writing, exporting or the device registry
> apply to **`for-later` only** and are labelled. Everything unlabelled is true of both.

## Parser hardening

The two branches run different parsers, and their limits genuinely differ — `for-later`'s
rewrite tightened several of them. Do not assume a number here without checking the branch.

| Risk | Mitigation |
|---|---|
| Unbounded allocation | 500 MB file cap; page size must be 512 B–1 MB. Table cap is **1000 on `main`**, 64 on `for-later`; `for-later` also requires the page size to divide the file. |
| Runaway chain walks | Visited-page cap — 10,000 on `main`, 200k pages on `for-later` |
| Out-of-bounds reads | Every row read is bounds-checked against its page end, not the buffer |
| Infinite loops | Visited-page set on every chain walk; row-group counts derived, not trusted |
| One bad row killing a library | Per-row `try/catch`; rows the presence bitmap marks absent are skipped |
| Prototype pollution | No `JSON.parse` of binary content; parsed data only ever lands in typed `Map`s and fixed-shape objects |

## Audio decoder hardening

The AIFF and WAV decoders read files the app did not write, on the same terms as the
database parser:

| Risk | Mitigation |
|---|---|
| A chunk header declaring more data than the file holds | Sample counts clamp to `bytes.length`, never to the declared length. A truncated file decodes what survived instead of reading past the end. |
| A header with zero channels or an absurd bit depth | Rejected with a message, before any allocation is sized from it |
| Runaway allocation | Output buffers are sized from the *clamped* frame count, so a forged header cannot ask for gigabytes |
| Chunk-walk loops | The walk advances by the declared size plus its pad byte and is bounded by the buffer; it cannot revisit |
| Leaked object URLs | `createObjectURL` for native playback is revoked when the track changes or the player closes |

Both are covered by tests for the truncated and malformed cases specifically, not just
the happy path.

## Output escaping — `for-later`

The CSV / M3U8 / filename escaping below lives in `src/lib/export/exporters.ts`, which is
on **`for-later` only**; `main` has no export pipeline. `main`'s one text output is the
recovery XML in `src/lib/recovery/xml.ts`, which does strip XML-illegal control characters.

Track metadata comes from a file we did not write, so every export path escapes it:

- **CSV** — cells starting `= + - @` get a leading apostrophe. Spreadsheets execute those
  as formulas otherwise. Covered by tests.
- **M3U8** — newlines stripped, so a crafted title cannot forge a playlist entry.
- **XML** — metacharacters escaped, XML-illegal control characters removed. Output is
  asserted to parse.
- **Filenames** — `safeFileName()` strips path separators and traversal.
- **Print window** — HTML built from escaped strings; no `dangerouslySetInnerHTML`
  anywhere in the codebase.

## Headers

`vercel.json` sets HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy` and a CSP. `script-src` has **no** `'unsafe-inline'` — verified on
both branches. `main` lost that tightening for a while: it was removed deliberately, then
came back when `main` was reverted to the pre-rollback tree, and nothing caught it because
this file kept asserting the stricter version. Restored 2026-10-26. `main` has no inline
scripts at all, so the directive had nothing legitimate to permit.
`style-src 'unsafe-inline'` remains — Radix and inline `style` props need it, and a static
SPA cannot use per-request nonces.

## Secrets

There are none. No `.env` files exist or are tracked; `.gitignore` covers `.env`,
`.env.local`, `.env.*.local` and `*.tsbuildinfo`. If you fork this and add a key, it does
not belong in the client bundle.

## Permissions

**`main` never asks for write access at all** — it opens drives `mode: 'read'` and has no
`createWritable` call anywhere.

On **`for-later`**, drives are still picked read-only and write permission is requested only
when the user first tries to save. Declining leaves the drive untouched.

## Reporting

Open a GitHub issue. If it involves data loss on **`for-later`**, include the drive's
`WHATTODOIFTHISWENTTOSHIT.txt` and the `backup.json` from the relevant snapshot — those
carry sizes and checksums and make the failure diagnosable. (`main` writes nothing to your
drive, so it cannot cause data loss.)

Please do not include your actual `export.pdb`; it contains your file paths.
