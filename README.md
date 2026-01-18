# RekordboxViewer

RekordboxViewer is a **web-based tool** for inspecting Rekordbox USB drives directly in the browser.

It lets DJs and music collectors **open a Rekordbox-exported USB**, read the Rekordbox database (`export.pdb` / `exportExt.pdb`), browse tracks and search without Rekordbox installed.

No uploads. No cloud sync. Everything runs locally in your browser.

---

## What This App Does

- 📂 Opens a Rekordbox USB or exported drive folder using the File System Access API
- 🔍 Automatically detects Rekordbox databases at:
- 🎵 Parses real track metadata from the Rekordbox device database
- 🔎 Search and filter by title, artist, album, or genre

---

## What This App Does *Not* Do (Yet)

- ❌ Modify USBs or Rekordbox databases
- ❌ Write tags back to files
- ❌ Sync with Rekordbox Cloud
- ❌ Parse playlists, cue points, beatgrids, or waveforms (planned)

This tool is **read-only by design**.

---

## Why This Exists

Rekordbox USBs contain a rich database, but it’s locked inside a proprietary binary format.

This project exists to:

- Inspect what’s actually on a Rekordbox USB
- Audit libraries before gigs
- Export track lists for backups, spreadsheets, or tooling
- Enable future Rekordbox-adjacent tools without reverse-engineering from scratch

---

## Tech Stack

- **React + Vite** — fast modern frontend
- **Tailwind CSS** — UI styling
- **File System Access API** — local folder access (no uploads)
- **rekordbox-parser** — binary parsing of Rekordbox device databases
- **Pure browser runtime** — no backend required

---

## Browser Support

This app requires the **File System Access API**, which is currently supported in:

- ✅ Chrome
- ✅ Edge
- ✅ Chromium-based browsers

⚠️ Safari and iOS browsers are **not supported** (API limitation).

---

## Local Development

```bash
npm install
npm run dev
