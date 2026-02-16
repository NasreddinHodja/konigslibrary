# Konigslibrary

A manga reader that runs in your browser. Upload ZIP/CBZ files and read them with scroll or page-turn mode, chapter navigation, zoom, and automatic progress saving.

## Quick Start (Browser Only)

Go to the hosted version and drop a ZIP/CBZ file in. No install needed, everything runs in your browser.

## Local Server

The local server lets you point Konigslibrary at a manga folder on your computer. It serves your files over your home network so you can read on your phone, tablet, or any device.

On mobile, the reader automatically enters fullscreen when you start reading — no browser chrome, just your manga. Swipe down from the top to exit fullscreen.

### One-Click Setup

Download one of these scripts. They handle everything — Node.js, building, and starting the server.

- **Linux / macOS**: download `konigslibrary.sh`, put it in an empty folder, and run it:
  ```
  chmod +x konigslibrary.sh
  ./konigslibrary.sh
  ```
- **Windows**: download `konigslibrary.bat`, put it in an empty folder, and double-click it.

The server prints something like this:

```
Konigslibrary running on:
  Local:   http://localhost:3000
  Network: http://192.168.1.50:3000
```

Open the Local URL on your computer to use the app. Set your manga folder in the settings.

### Reading on Your Phone

Your phone needs to be on the same WiFi network as your computer.

1. Open the Network URL on your phone (e.g. `http://192.168.1.50:3000`)
2. Optionally use Chrome menu > **Add to Home Screen** for quick access
3. Select a manga and chapter — the reader goes fullscreen automatically

### For Developers

Requires Node.js 22+.

```bash
git clone https://github.com/NasreddinHodja/konigslibrary
cd konigslibrary
npm install
npm run build:local
npm run serve
```

- `npm run build:local` — builds with `adapter-node` (sets `LOCAL_BUILD=1`)
- `npm run serve` — starts the server on port 3000, bound to `0.0.0.0`

Set your manga directory:
```bash
MANGA_DIR=/path/to/manga npm run serve
```

Or configure it through the app's settings page (saves to `konigslibrary.json`).

Custom port:
```bash
PORT=8080 npm run serve
```

### Manga Folder Structure

Point Konigslibrary at a folder containing your manga. It supports:

- **Directories** — each subfolder is a manga. Inside, either put images directly (single chapter) or use subfolders for chapters:
  ```
  manga/
    one-piece/
      chapter-001/
        001.jpg
        002.jpg
      chapter-002/
        001.jpg
        002.jpg
    akira/
      001.jpg
      002.jpg
  ```
- **ZIP/CBZ files** — drop `.zip` or `.cbz` files in the folder. Chapters are auto-detected from the directory structure inside the archive.
