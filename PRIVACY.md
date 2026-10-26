# Privacy

## Your library never leaves your browser

`export.pdb` is read with the File System Access API and parsed in JavaScript on your
machine. There is no server, no upload endpoint, and no account. Track names, playlists,
file paths and drive contents are never transmitted anywhere.

Verify it yourself: open DevTools → Network, load a drive, and watch. Nothing goes out.

**Audio is no exception.** Playing a track reads that file from your drive into browser
memory and decodes it there — AIFF and some WAV variants are decoded by code in this app,
because no Chromium can play them. The audio is never uploaded, streamed, or sent to a
codec service, and nothing is cached to disk.

## What is stored locally

**On the live site (`rekordbox-explorer.vercel.app`)** the only thing stored is
`localStorage`:

| Where | What | How to clear |
|---|---|---|
| `localStorage` | Theme, text size, column layout | Clear site data in your browser |

Nothing else. The live build uses no IndexedDB, writes nothing to your USB drive, and never
asks for write access — it opens drives read-only and has no code that could write to one.

**The editor build** (the `for-later` branch, not currently deployed to the live site) adds
two more, because it can write playlists back to a stick:

| Where | What | How to clear |
|---|---|---|
| `IndexedDB` | Device registry: drive names, track/playlist counts, and a title/artist/album index per drive, for cross-drive search | My drives → Clear all |
| Your USB drive | Backup snapshots and `WHATTODOIFTHISWENTTOSHIT.txt` | Backups & recovery → delete, or remove the folders by hand |

All of it stays on your device. None of it is synced.

## The one network call

The hosted build at `rekordbox-explorer.vercel.app` loads
[Vercel Analytics](https://vercel.com/docs/analytics/privacy-policy), which records
anonymous page views: page path, referrer, user agent, and coarse country from your IP.
No cookies, no cross-site tracking, and **no library data** — it fires on page load and
knows nothing about your drive.

To avoid it entirely: block it in your ad blocker, or run the app locally with
`npm run dev`. To remove it from a fork, delete the `<Analytics />` element in
`src/App.tsx`.

## Permissions

The live site asks for **read** access only, when you pick a drive. It never asks for
write access, because it has no code that writes to a drive.

The editor build asks separately for **write** access the first time you save a playlist or
create a backup — declining leaves the drive untouched. Permission lasts for the session;
the browser re-asks next time.

## Reporting

Found something that contradicts this document? Open an issue. That is a bug.
