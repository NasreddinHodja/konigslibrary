# Konigslibrary

A manga reader that runs in your browser. Upload ZIP/CBZ files and read them with scroll or page-turn mode, chapter navigation, zoom, and automatic progress saving.

## Usage

### Browser only

Go to the hosted version and drop a ZIP/CBZ file in. No install needed, everything runs in your browser.

### Android app

Download the APK from the site, install it, and upload ZIPs directly on your phone.

### Local server + Android

Serve your manga library from your computer and browse it from any device on your network.

1. Download the server script for your OS (Linux/Mac `.sh` or Windows `.bat`) from the site
2. Put it in an empty folder and run it — it handles Node.js, building, and starting the server
3. Open the local URL in your browser and set your manga directory in Settings
4. On your phone, install the APK, enter your server's IP address, and browse your library

## For Developers

Requires Node.js 22+.

```bash
git clone https://github.com/NasreddinHodja/konigslibrary
cd konigslibrary
npm install
npm run build:local
npm run serve
```

- `npm run dev` — dev server
- `npm run build` — production build (adapter-auto, for Vercel)
- `npm run build:local` — local server build (adapter-node, sets `LOCAL_BUILD=1`)
- `npm run serve` — starts the server on port 3000, bound to `0.0.0.0`
- `npm run check` — Svelte type checking
- `npm run lint` — Prettier + ESLint
- `npm run format` — auto-format with Prettier

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
