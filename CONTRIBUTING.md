# Contributing

## Setup

```bash
npm install
npm run dev      # localhost:8080
npm test
npm run lint
```

## Before a PR

```bash
npm test && npm run lint && npm run build
```

All three must pass. Tests are not optional for anything under `src/lib/`.

## The one rule that matters

**Do not weaken the write-safety invariants.** They are listed in `CLAUDE.md` and enforced
by tests in `src/lib/pdb/playlists.test.ts` and `src/lib/usb/commit.test.ts`. If your
change makes one of those tests fail, the change is wrong — not the test.

In particular:

- Writes append. They never overwrite existing pages.
- Nothing is written without a verified backup first.
- Anything written is read back and verified.
- Only playlist tables (page types 7 and 8) are ever written.

## Layering

```
components/  →  hooks/  →  lib/usb/  →  lib/pdb/
```

No React below `hooks/`. No `DataView` above `lib/`. Pure logic gets a colocated
`*.test.ts`.

## Testing binary code

Use `src/test/fixtures/pdb-fixture.ts` to build synthetic `.pdb` images. It is written
independently of the writer on purpose — do not refactor it to share the writer's encoding.

Use `src/test/fixtures/memory-fs.ts` for anything touching a drive. It supports fault
injection, so "the drive corrupted the write" is a unit test, not a hope.

## Format changes

Cite the source. The reference is
[crate-digger's `rekordbox_pdb.ksy`](https://github.com/Deep-Symmetry/crate-digger/blob/main/src/main/kaitai/rekordbox_pdb.ksy).
If you are working from observation rather than the spec, say so in a comment — the
previous album parser was four undocumented guesses stacked on each other, and it took a
review to notice.

## Hardware reports are the most valuable contribution

If you write a playlist with this app and load the drive on real gear, open an issue with
the model, firmware version and what happened — working or not. That is the coverage no
test suite can provide. See `roadmap.md` for the matrix we are trying to fill.

## Style

- Comments explain *why*, especially byte offsets and safety decisions.
- Error messages are read by a DJ before a gig: what happened, what state the drive is in,
  what to do next.
- No `console.log` in shipping paths.
- Only add a shadcn component if it is actually imported.
