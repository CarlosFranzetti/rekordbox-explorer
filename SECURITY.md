# Security

## Threat model

This app has no server, no accounts and no secrets. Two things matter:

1. **`export.pdb` is untrusted input.** It is a binary file the app did not write, and a
   malformed or hostile one must not crash, hang, or exfiltrate anything.
2. **Writes are destructive by nature.** The worst realistic outcome is a lost library, not
   a compromised machine — so the safety work lives in `lib/usb/`, not here.

## Parser hardening

| Risk | Mitigation |
|---|---|
| Unbounded allocation | 500 MB file cap; page size must be 512 B–1 MB and divide the file; ≤64 tables; ≤200k pages |
| Out-of-bounds reads | Every row read is bounds-checked against its page end, not the buffer |
| Infinite loops | Visited-page set on every chain walk; row-group counts derived, not trusted |
| One bad row killing a library | Per-row `try/catch`; rows the presence bitmap marks absent are skipped |
| Prototype pollution | No `JSON.parse` of binary content; parsed data only ever lands in typed `Map`s and fixed-shape objects |

## Output escaping

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
`Permissions-Policy` and a CSP. `script-src` has **no** `'unsafe-inline'`.
`style-src 'unsafe-inline'` remains — Radix and inline `style` props need it, and a static
SPA cannot use per-request nonces.

## Secrets

There are none. No `.env` files exist or are tracked; `.gitignore` covers `.env`,
`.env.local`, `.env.*.local` and `*.tsbuildinfo`. If you fork this and add a key, it does
not belong in the client bundle.

## Permissions

Drives are picked read-only. Write permission is requested only when the user first tries
to save. Declining leaves the drive untouched.

## Reporting

Open a GitHub issue. If it involves data loss, include the drive's
`WHATTODOIFTHISWENTTOSHIT.txt` and the `backup.json` from the relevant snapshot — those
carry sizes and checksums and make the failure diagnosable.

Please do not include your actual `export.pdb`; it contains your file paths.
