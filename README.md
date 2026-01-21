# 🎧 Rekordbox Explorer

**Your Rekordbox Library. In Your Browser. Anywhere.**

A modern, web-based viewer for Rekordbox USB exports. Parse `export.pdb` directly in your browser with zero upload time. No installation required.

**Now with PDF Export, Custom Layouts, and Hardware Compatibility Checks!** 📄✨

---

## 🚀 Key Features

- **⚡ Instant Loading**: Parse `export.pdb` directly in your browser.
- **📱 Responsive**: Optimized for desktop and mobile.
- **🎛️ Compatibility Check**: Instantly see if your USB works on CDJ-2000, 3000, or Opus-Quad (Legacy vs. Device Library Plus).
- **📄 PDF Export**: Generate professional, printable setlists. **Respects your visible column settings!**
- **📊 Custom Columns**: Reorder or toggle columns like Genre, BPM, Key, Label, Year, etc.
- **🎨 Customization**: Dark/Light modes, font scaling, and column visibility.

---

## 📱 **IMPORTANT: iPhone / iPad Usage**

We've optimized the experience for mobile devices, but iOS has specific security rules for file access.

1.  **Connect your USB** to your iPhone/iPad.
2.  Open this app in **Safari**.
3.  Tap **Select export.pdb** (Folder selection is not supported on iOS).
4.  Navigate to `PIONEER` ➡️ `rekordbox` and select **`export.pdb`**.

---

## 🛠 How To Use

1.  **Connect USB**: Plug in your Rekordbox-exported USB.
2.  **Open App**: Visit the deployed URL (or run locally).
3.  **Select Folder**: Click "Open USB Drive" and select your USB root.
4.  **Browse**: View tracks, playlists, and check hardware compatibility.

**Customizing the View:**
- **Reorder Columns**: Drag and drop column headers.
- **Show/Hide Columns**: Click the **Settings (Gear)** icon.
- **Themes**: Switch themes or adjust text size in Settings.

---

## 💻 Key Technologies

- **jspdf**: Client-side PDF generation.
- **rekordbox-parser**: Custom binary parser for Pioneer databases (export.pdb).

---

## 🏃‍♂️ Run Locally

```bash
npm install
npm run dev
```