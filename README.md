# Rekordbox Explorer

Rekordbox Explorer is a lightweight web app for quickly browsing the contents of a Rekordbox USB export (export.pdb) without loading the full Rekordbox application. It lets you inspect tracks, playlists and the file layout on a USB drive or folder using your browser's File System Access API.

Key features
- Detect and parse a Rekordbox `export.pdb` from a USB drive or folder.
- Browse playlists and track metadata (title, artist, album, BPM, key, duration, etc.).
- File browser view to inspect the files and folder structure on the drive.
- Full-scan fallback if the standard Rekordbox folder structure is not present.
- Works entirely in the browser (no server required) — requires a modern Chromium-based browser that supports the File System Access API.

How it works
- The app uses the File System Access API to let you select a USB drive or a folder.
- It looks for the standard Rekordbox path `PIONEER/rekordbox/export.pdb` and, if found, parses the database to extract tracks and playlists.
- If the standard path isn't present, the app can perform a full recursive scan to locate `export.pdb`.

Quick start (development)
1. Clone the repository:

```bash
git clone <YOUR_GIT_URL>
cd rekordbox-explorer
```

2. Install dependencies:

```bash
npm ci
```

3. Run the dev server:

```bash
npm run dev
```

4. Open the app in a Chromium-based browser (Chrome, Edge, Opera) and click "Select USB or Folder".

Building for production
- Build: `npm run build`
- Preview the production build: `npm run preview`
- The production build outputs to the `dist` directory by default.

Browser compatibility and limitations
- Requires a browser that supports the File System Access API (Chromium-based browsers). Safari and Firefox do not currently support the full API used by the app.
- The app runs client-side; do not store secret API keys in client code. If you need to call external APIs that require secrets, use server-side endpoints or serverless functions.

Deployment (Vercel / static hosts)
- Build command: `npm run build`
- Install command: `npm ci` (or leave blank to let Vercel auto-detect)
- Output directory: `dist`
- If you deploy to Vercel and use server-side API routes, add any required environment variables in the Vercel project settings.

Project structure (high-level)
- `src/` — application source code\- `src/components/` — React components (Landing screen, Library view, File browser, etc.)\- `src/hooks/` — custom hooks (Rekordbox scanning & parsing)\- `src/lib/rekordbox-parser.ts` — Rekordbox export.pdb detection and parsing utilities\- `src/types/` — TypeScript types used across the app\n
Contributing
- Contributions are welcome. Open an issue or a pull request describing the change you'd like to make.

License
- This project is provided under the MIT license.

