# 🎧 RekordboxViewer

**Your Rekordbox Library. In Your Browser. Anywhere.**

RekordboxViewer is a fast, web-based tool for inspecting Rekordbox USB drives directly in your browser. No need to install Rekordbox on a friend's laptop just to check your playlist.

**Now with PDF Export!** 📄✨

---

## 🚀 What This App Does

- **📂 Instant Access**: Open any Rekordbox-exported USB or folder.
- **🔍 Deep Search**: Filter tracks by Title, Artist, Album, Genre, Key, or BPM.
- **📄 PDF Export**: **NEW!** Generate professional, printable setlists from your playlists. Perfect for submission to promoters, radio stations, or keeping a hard copy in the booth.
- **⚡️ Lightning Fast**: Parses the binary `export.pdb` database locally. Zero upload time.
- **📱 Mobile Ready**: Works on your iPhone or iPad (see below!).

---

## 📱 **iOS & Mobile Support: YES!**

We've removed the barriers. You can now use RekordboxViewer on your iPhone or iPad.

**How to be a mobile wizard:**
1.  **Connect your USB** to your iPhone/iPad (using a Lightning/USB-C adapter).
2.  Open this app in **Safari**.
3.  Tap the **Select export.pdb** button.
4.  Navigate to your USB drive in the Files app.
5.  Go to `PIONEER` ➡️ `rekordbox` ➡️ and tap **`export.pdb`**.

**BOOM!** 💥 Your entire library is now in your pocket. Search tracks and check keys right from the booth.

---

## 🛠 Features

- **Read-Only Safety**: We never modify your USB files. Safe for gig day.
- **Metadata Parsing**: Reads real track data (BPM, Key, Duration, etc.) directly from the Rekordbox device database.
- **Playlist Views**: Browse your organized playlists just like on CDJs.
- **No Cloud Required**: 100% local execution. Your library data never leaves your device.

---

## 💻 Tech Stack

Built with modern web tech for speed and reliability:

- **React + Vite**: Blazing fast frontend.
- **Tailwind CSS + Shadcn/UI**: Beautiful, responsive interface.
- **File System Access API**: Native folder browsing support (Desktop).
- **jspdf**: Client-side PDF generation.
- **rekordbox-parser**: Custom binary parser for Pioneer databases.

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
