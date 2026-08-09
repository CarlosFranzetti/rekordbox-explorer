# Rekordbox Explorer — CLAUDE.md

Browser-based viewer for Rekordbox USB exports. Parses the binary `export.pdb` file directly in the browser — no server, no uploads.

## Tech Stack

- **React 18** + **Vite** (SWC) + **TypeScript**
- **TailwindCSS 3** for styling
- **shadcn/ui** (Radix UI primitives) for all UI components — components live in `src/components/ui/`
- **React Router DOM 6** for routing
- **next-themes** for dark/light/custom theme management
- **jsPDF + jspdf-autotable** for PDF export
- **react-qr-code** for QR code generation (donate section)
- **Vitest** for testing

## Key Files

| File | Purpose |
|------|---------|
| `src/pages/Index.tsx` | Entry page — switches between LandingScreen and LibraryView |
| `src/components/LandingScreen.tsx` | File/folder selection UI (the "home screen") |
| `src/components/LibraryView.tsx` | Main library layout (sidebar + track table) |
| `src/components/PlaylistSidebar.tsx` | Playlist tree, settings button, theme/font controls |
| `src/components/TrackTable.tsx` | Resizable, sortable track table with drag-and-drop columns |
| `src/components/DonateSection.tsx` | Donation buttons shown at bottom of landing card |
| `src/lib/rekordbox-parser.ts` | Binary `.pdb` parser — the core engine |
| `src/lib/pdf-export.ts` | PDF generation logic |
| `src/hooks/useRekordbox.ts` | Data loading, File System Access API, state management |
| `src/hooks/useSettings.ts` | Settings persistence via localStorage (theme, font, columns) |
| `src/types/rekordbox.ts` | TypeScript interfaces (Track, Playlist, RekordboxDatabase, etc.) |

## Dev Commands

```bash
npm run dev      # start dev server (localhost:8080)
npm run build    # production build
npm run preview  # preview production build
npm test         # run Vitest tests
```

## Important Notes

- **File System Access API**: Used for folder selection (Chrome/Edge/Opera). Safari/iOS falls back to single-file input (`<input type="file">`). See `isFileSystemAccessSupported()` in `useRekordbox.ts`.
- **Settings persistence**: All user preferences (theme, font size, column visibility/order/widths) are stored in `localStorage`.
- **Themes**: Defined as CSS variables in `src/index.css`. Supported: `dark`, `midnight`, `light` (sepia), `arctic`. Managed via `next-themes` and `useSettings`.
- **Hardware compatibility**: Detects Legacy library (`export.pdb`) vs Device Library Plus (`exportExt.pdb`) to show CDJ compatibility info.
- **No backend**: The entire app runs client-side. There is no server component.
- **Binary parser**: `rekordbox-parser.ts` reads Pioneer's proprietary `.pdb` format directly as `ArrayBuffer` in the browser.

## Donation Links (DonateSection)

- PayPal: `https://paypal.me/losfiesta`
- Cash App: `https://cash.app/$hypedrum`
