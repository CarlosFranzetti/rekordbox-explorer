<div align="center">

# 🎧 Rekordbox Explorer

**Open your rekordbox USB in a browser. Browse it, edit playlists, print setlists.**
**Nothing is uploaded. Nothing is installed.**

[Open the app](https://rekordbox-explorer.vercel.app) ·
[What it does](#what-it-does) ·
[Editing &amp; safety](#editing-playlists) ·
[Player compatibility](#will-my-player-read-it) ·
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
| ⚡ **Reads your drive instantly** | Tracks, artists, albums, genres, keys, labels, the full playlist tree. No install, no wait. |
| ✏️ **Edits playlists** | Create, rename, delete, reorder. Add and remove tracks. Undo/redo. Then write it back to the USB. |
| 🛡️ **Refuses to lose your library** | Two verified backups on the drive before any write, read-back verification after, automatic rollback if anything fails. |
| 🆘 **Recovers when it goes wrong** | Browse, verify and restore backups in-app — plus a plain-text rescue guide written to the drive itself. |
| 💾 **Remembers every drive** | Search across every stick you have ever opened. Find which one has that track. |
| 📄 **Exports six ways** | PDF · print · CSV · M3U8 · plain text · JSON · rekordbox XML. |
| 🎛️ **Tells you the truth about hardware** | Which players will read this drive, and which will not. |
| 🌗 **Readable in a dark booth** | Four themes, text scaling to 28 px, real touch targets, works on a phone. |

## Quick start

1. Plug in your rekordbox USB.
2. Open the app in **Chrome, Edge or Opera** on a desktop.
3. Click **Select USB or Folder** and pick the drive's root.
4. Browse. Edit. Export.

**On iPhone / iPad / Safari / Firefox:** these browsers cannot open folders, so you get
read-only mode. Tap **Select export.pdb File**, then navigate to
`PIONEER` → `rekordbox` → `export.pdb`. You can browse and export; editing needs a desktop
Chromium browser.

## Editing playlists

Edits are staged in the browser and undoable. Nothing touches the drive until you press
**Save to USB**. Then, in order:

```
1  Request write access          5  Re-parse it and confirm it says what we meant
2  Read the current library      6  Write to the drive
3  Back up to TWO places         7  Read it back, compare SHA-256, re-parse
   and verify every byte         8  Refresh the recovery note
4  Build the new library
```

If step 6 or 7 fails, **the backup from step 3 is restored automatically** before you see
the error. There is no path that leaves the drive in a state that was not verified or
rolled back.

### What is never touched

Your audio files. Waveforms, beatgrids, hot cues and memory points (those live in separate
analysis files). Track, artist, album and artwork records. Only playlist tables are
rewritten, and only by **appending new pages** — every existing byte survives intact.

### Backups

Every snapshot is written to two different folders on the drive, so losing one folder
cannot lose your history:

```
/RBXPLORER_BACKUPS/                       ← vault 1
/PIONEER/rekordbox/RBXPLORER_SAFETY/      ← vault 2
/WHATTODOIFTHISWENTTOSHIT.txt             ← offline rescue guide
```

Each snapshot carries SHA-256 checksums and is verified on write. Keep 3–20 (default 5).
Restoring is itself snapshotted first, so it is undoable. You can export any snapshot — or
all of them — as a ZIP.

That `.txt` at the drive root is not a joke file. If your library breaks at a gig with no
internet, it walks you through restoring it with nothing but a file manager.

## Will my player read it?

| Hardware | Reads a drive this app writes |
|---|---|
| CDJ-2000 / nexus / NXS2, CDJ-900 | ✅ |
| CDJ-3000 (firmware ≤ 3.22) | ✅ |
| XDJ-1000 / RX / RX2 / XZ | ✅ |
| **OPUS-QUAD, OMNIS-DUO, XDJ-AZ, CDJ-3000X** | ❌ needs Device Library Plus |

Newer gear requires AlphaTheta's newer encrypted format, which this app does not write.
The fix: plug the drive into **rekordbox 6.6.11 or later** and let it convert the device
library. Your playlists carry over. The app tells you which case you are in.

## Development

```bash
npm install
npm run dev      # http://localhost:8080
npm test         # 155 tests
npm run build
npm run lint
```

Architecture, format details and safety invariants: **[`trd.md`](trd.md)**.
Product scope: **[`prd.md`](prd.md)**. What's next: **[`roadmap.md`](roadmap.md)**.
The full format research — page layouts, row structures, corruption analysis, hardware
compatibility — is in **[`research_playlistHelp.md`](research_playlistHelp.md)**.

### How it is built

React 18 · Vite · TypeScript · Tailwind · shadcn/ui · Vitest. No backend, no accounts, no
network calls with your data. The binary parser is hand-written against the
[crate-digger](https://github.com/Deep-Symmetry/crate-digger) Kaitai spec.

## Privacy

Your library never leaves the browser — no uploads, no accounts, no server. The hosted
build does load Vercel's analytics script for anonymous page-view counts; details and how
to avoid it in [`PRIVACY.md`](PRIVACY.md).

## Support the project

It is free, has no accounts, and never uploads your data. If it saved you a headache:

| | |
|---|---|
| **PayPal** | [paypal.me/losfiesta](https://paypal.me/losfiesta) |
| **Cash App** | [$hypedrum](https://cash.app/$hypedrum) |

Both are one tap in the app — QR codes too, on the landing screen.

## Credits

The `.pdb` format was reverse-engineered by [@henrybetts](https://github.com/henrybetts),
[@flesniak](https://github.com/flesniak) and
[Deep Symmetry](https://github.com/Deep-Symmetry/crate-digger). This project would not
exist without their work.

Not affiliated with, endorsed by, or supported by AlphaTheta / Pioneer DJ.
`rekordbox` is their trademark.

## License

MIT — see [`LICENSE`](LICENSE).
