# 🎧 RekordboxViewer

**Your Rekordbox Library. In Your Browser. Anywhere.**

RekordboxViewer is a fast, web-based tool for inspecting Rekordbox USB drives directly in your browser. No need to install Rekordbox on a friend's laptop just to check your playlist.

**Now with PDF Export, Custom Layouts, and Hardware Compatibility Checks!** 📄✨

---

## 🚀 Key Features

- **📂 Instant Access**: Open any Rekordbox-exported USB or folder.
- **🔍 Deep Search**: Filter tracks by Title, Artist, Album, Genre, Key, or BPM.
- **📄 PDF Export**: Generate professional, printable setlists from your playlists. **Respects your visible column settings!**
- **📊 Custom Columns**: 
  - **Reorder**: Drag and drop column headers to rearrange them.
  - **Toggle**: Hide/Show columns like Genre, BPM, Key, Label, Year, etc. (Title, Artist, Album are always visible).
- **✅ Compatibility Check**: Automatically detects if your USB has "Legacy" libraries (CDJ-2000NXS2 & older) or "Device Library Plus" (CDJ-3000, Opus-Quad).
- **⚡️ Lightning Fast**: Parses the binary `export.pdb` database locally. Zero upload time.
- **🎨 Themes**: Choose from Dark, Midnight, Sepia, or Arctic themes.

---

## 📱 **IMPORTANT: iPhone / iPad Usage**

We've optimized the experience for mobile devices, but iOS has specific security rules for file access.

**Step-by-Step Guide:**
1.  **Connect your USB** to your iPhone/iPad (using a Lightning/USB-C adapter).
2.  Open this app in **Safari**.
3.  Tap the **Select export.pdb** button (Folder selection is not supported on iOS).
4.  Navigate to your USB drive in the Files app picker.
5.  Go to the folder `PIONEER` ➡️ `rekordbox`.
6.  Select the file named **`export.pdb`**.

**Success!** 💥 Your library will load instantly. You can now search tracks and verify keys right from the booth.

---

## 🛠 How To Use

### 1. Loading your Library
- **Desktop**: Click "Select USB or Folder" and pick the root of your USB drive. We'll find the database automatically.
- **Mobile**: Use the "Select export.pdb" button as described above.

### 2. Customizing the View
- **Reorder Columns**: On desktop, simply click and drag a column header (e.g., "BPM") to a new position.
- **Show/Hide Columns**: Click the **Settings (Gear)** icon in the bottom-left corner. Under "Visible Columns", check or uncheck the data you want to see.
- **Themes & Font Size**: Use the same Settings panel to switch themes or adjust the text size for better readability in dark clubs.

### 3. Exporting to PDF
1.  Navigate to the playlist you want to print.
2.  Customize your columns (hide what you don't need).
3.  Click the **PDF Icon** in the top header.
4.  A PDF will be generated containing only the visible columns for that playlist.

---

## 💻 Tech Stack

Built with modern web tech for speed and reliability:

- **React + Vite**: Blazing fast frontend.
- **Tailwind CSS + Shadcn/UI**: Beautiful, responsive interface.
- **File System Access API**: Native folder browsing support (Desktop).
- **jspdf**: Client-side PDF generation.
- **rekordbox-parser**: Custom binary parser for Pioneer databases (export.pdb).

---

## 🏃‍♂️ Run Locally

Want to hack on it?

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev
```

---

*Note: This project is not affiliated with AlphaTheta/Pioneer DJ. It is an open-source tool for the community.*