# Third-party code and prior art

## Vendored code

### OneLibrary — `src/lib/onelibrary/{sqlcipher,sqlite,sqlite-write}.js`

Copied verbatim from **[v1vendi/onelibrary](https://github.com/v1vendi/onelibrary)**,
`viewer/src/`, at commit `a31baa5`. Copyright © 2026 v1vendi, MIT licence.

Three files, ~750 lines, no dependencies:

| File | What it does |
|---|---|
| `sqlcipher.js` | SQLCipher 4 decrypt **and** encrypt using WebCrypto only |
| `sqlite.js` | Pure-JS SQLite reader — b-tree walk, record decode, overflow pages |
| `sqlite-write.js` | Serialises tables back into a SQLite image |

**They are kept as unmodified `.js` on purpose.** Types live beside them in
`index.d.ts` and `tsc` does not check them, so an upstream fix applies as a
clean `diff` instead of having to be re-derived through a TypeScript port. If
something here needs to change, change it upstream and re-vendor.

Why vendor rather than depend: the upstream project publishes the viewer as an
application, not as an npm package, and this app has a hard no-runtime-CDN rule
(the CSP forbids external script hosts). Vendoring three dependency-free files
is smaller and more auditable than the alternatives.

To re-sync:

```bash
git clone --depth 1 https://github.com/v1vendi/onelibrary /tmp/onelibrary
cp /tmp/onelibrary/viewer/src/sqlcipher.js    src/lib/onelibrary/sqlcipher.js
cp /tmp/onelibrary/viewer/src/sqlite.js       src/lib/onelibrary/sqlite.js
cp /tmp/onelibrary/viewer/src/sqlite_write.js src/lib/onelibrary/sqlite-write.js
# re-add the attribution header to each, then:
npm test
```

`src/test/fixtures/onelibrary-sample.db` is that project's sample export — a
real SQLCipher database of three Kevin MacLeod tracks (CC BY 4.0,
incompetech.com). It is the fixture the OneLibrary tests run against, so they
exercise the genuine production key path rather than something we synthesised.

## Not vendored: the audio decoders

`src/lib/audio/aiff.ts` and `wav.ts` are written from the format specifications
rather than adapted from an existing library, and they pull in no dependency.

That is deliberate. The published JS decoders are either Node-only, carry a
`Buffer` polyfill, or decode into a shape that would need converting anyway; the
part this app actually needs — uncompressed PCM out of a chunked container — is
a few hundred lines of arithmetic. Every awkward case is covered by a test
because there is nothing to cross-check against: Chrome cannot decode AIFF at
all, so the tests are the only proof the decoder is right.

FLAC, MP3 and AAC are **not** decoded here. The browser plays those natively,
and shipping a decoder for a format that already works would be strictly worse.

## Prior art this project depends on but does not vendor

The `.pdb` format is not documented by Pioneer. Everything this app knows about
it comes from other people's reverse engineering, published freely:

- **[Deep Symmetry / crate-digger](https://github.com/Deep-Symmetry/crate-digger)** —
  James Elliott's Kaitai Struct specification for `export.pdb`, the most
  complete public description of the format and the reference this project
  checks itself against.
- **[@henrybetts](https://github.com/henrybetts/Rekordbox-Decoding)** — the
  original DeviceSQL page and row layout work.
- **[@flesniak](https://github.com/flesniak/python-prodj-link)** — the
  `python-prodj-link` analysis, including the ANLZ files.
- **[v1vendi/onelibrary](https://github.com/v1vendi/onelibrary)** — the
  OneLibrary specification: SQLCipher parameters, the schema, the WAL trap,
  and the finding that cues live in ANLZ rather than in the `cue` table.

None of this obliges us to anything — facts about a file format are not
copyrightable — but crediting it is both honest and how you stay welcome in a
community that gave this away for free.
