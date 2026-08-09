<div align="center">

# 🎧 Rekordbox Explorer

**Your rekordbox USB, in the browser. No uploads. No installs.**

[Open the app](https://rekordbox-explorer.vercel.app) ·
[What it does](#what-it-does) ·
[Player compatibility](#will-my-player-read-it) ·
[Project state](#project-state) ·
[Support it](#support-the-project)

</div>

---

Your library lives on a USB stick you cannot inspect without installing a 1 GB
application. This reads that stick's `export.pdb` directly in the browser — the whole
binary parser runs client-side, there is no server, and your library never leaves your
machine.

## What it does

| | |
|---|---|
| ⚡ **Reads your drive instantly** | Tracks, artists, albums, genres, keys, labels, the full playlist tree. |
| 🔍 **Search and sort** | Resizable, reorderable columns. Browse raw files too. |
| 📄 **PDF setlists** | Printable, respects your visible columns. |
| 🎛️ **Tells you the truth about hardware** | Which players will read this drive, and which will not. |
| 🌗 **Readable in a dark booth** | Four themes, font scaling, works on a phone. |

## Quick start

1. Plug in your rekordbox USB.
2. Open the app in **Chrome, Edge or Opera** on a desktop.
3. Click **Select USB or Folder** and pick the drive's root.

**On iPhone / iPad / Safari / Firefox:** these browsers cannot open folders. Tap
**Select export.pdb File**, then navigate to `PIONEER` → `rekordbox` → `export.pdb`.

## Will my player read it?

| Hardware | Reads `export.pdb` |
|---|---|
| CDJ-2000 / nexus / NXS2, CDJ-900 | ✅ |
| CDJ-3000 (firmware ≤ 3.22) | ✅ |
| XDJ-1000 / RX / RX2 / XZ | ✅ |
| **OPUS-QUAD, OMNIS-DUO, XDJ-AZ, CDJ-3000X** | ❌ needs Device Library Plus |

Newer gear requires AlphaTheta's newer encrypted format. Plug the drive into **rekordbox
6.6.11 or later** and let it convert the device library — your playlists carry over. The
app tells you which case you are in.

## Project state

Two branches, on purpose:

| Branch | What | Status |
|---|---|---|
| **`main`** | The **viewer** described above | ✅ Live |
| **`for-later`** | The **playlist editor**: create/edit playlists and write them back to the USB, with dual verified on-drive backups, a verified write pipeline with automatic rollback, a cross-drive device registry, six export formats, and 155 tests | ⏸️ Built, then rolled back from production. Parked pending diagnosis. |

The editor release was merged, deployed, and rolled back after issues in production. The
work is intact on `for-later`; nothing was lost. What is known, what is suspected, and
what has to happen before it re-lands is written up in **[`memorystate.md`](memorystate.md)**
and **[`roadmap.md`](roadmap.md)**.

**If you hit a bug, a console error is worth more than a bug report.** That is the one
thing currently blocking the editor from shipping.

## Documentation

| | |
|---|---|
| [`memorystate.md`](memorystate.md) | Current state, decisions with reasons, landmines. **Start here.** |
| [`roadmap.md`](roadmap.md) | What's missing, and which branch each item belongs on |
| [`database.md`](database.md) | Which Pioneer databases we read/write and why — the case for and against each |
| [`research_playlistHelp.md`](research_playlistHelp.md) | Full `.pdb` format reference and the corruption analysis |
| [`prd.md`](prd.md) · [`trd.md`](trd.md) | Product scope · architecture |
| [`PRIVACY.md`](PRIVACY.md) · [`SECURITY.md`](SECURITY.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md) | |

## Development

```bash
npm install
npm run dev      # http://localhost:8080
npm run build
npm test
```

React 18 · Vite · TypeScript · Tailwind · shadcn/ui. No backend, no accounts. The binary
parser is hand-written against the
[crate-digger](https://github.com/Deep-Symmetry/crate-digger) Kaitai spec.

## Privacy

Your library never leaves the browser. The hosted build loads Vercel's analytics script
for anonymous page-view counts — details in [`PRIVACY.md`](PRIVACY.md).

## Support the project

Free, no accounts, never uploads your data. If it saved you a headache:

| | |
|---|---|
| **PayPal** | [paypal.me/losfiesta](https://paypal.me/losfiesta) |
| **Cash App** | [$hypedrum](https://cash.app/$hypedrum) |

## Credits

The `.pdb` format was reverse-engineered by [@henrybetts](https://github.com/henrybetts),
[@flesniak](https://github.com/flesniak) and
[Deep Symmetry](https://github.com/Deep-Symmetry/crate-digger). This project would not
exist without their work.

Not affiliated with, endorsed by, or supported by AlphaTheta / Pioneer DJ.
`rekordbox` is their trademark.

## License

MIT — see [`LICENSE`](LICENSE).
