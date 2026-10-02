<script lang="ts">
  import { onMount } from 'svelte';
  import BackLink from '$lib/ui/BackLink.svelte';
  import { fetchDownloadLinks, DEFAULT_DOWNLOAD_LINKS } from '$lib/utils/update';

  let downloads = $state(DEFAULT_DOWNLOAD_LINKS);

  onMount(async () => {
    downloads = await fetchDownloadLinks();
  });

  const README = 'https://github.com/NasreddinHodja/konigslibrary#self-hosted-server';

  const folder = `My Manga/
├── One Piece/
│   ├── cover.jpg
│   ├── chapter_0001-00.cbz
│   ├── chapter_0002-00.cbz
│   └── chapter_0002-05.cbz
└── Berserk/
    ├── cover.png
    ├── 001.cbz
    └── 002.cbz`;

  const comicInfo = `<ComicInfo>
  <Series>One Piece</Series>
  <Summary>Luffy sets out to find the One Piece.</Summary>
  <Year>1997</Year>
  <Writer>Oda Eiichiro</Writer>
  <Genre>Action, Adventure</Genre>
  <Status>Ongoing</Status>
</ComicInfo>`;
</script>

<div class="mx-auto max-w-2xl space-y-10 p-8">
  <BackLink label="BACK" href="/" />

  <h1 class="text-2xl font-bold">How to use konigslibrary</h1>

  <p class="text-sm leading-relaxed text-soft">
    konigslibrary reads manga stored as <code>.cbz</code> files. Your folders have to follow the
    layout in
    <a href="#preparing" class="border-b border-line-strong hover:border-fg/80">Preparing your manga</a>.
  </p>

  <h2 class="pt-4 text-xl font-bold">Pick how you want to read</h2>

  <section class="space-y-3">
    <h3 class="text-lg font-bold text-soft">In this browser</h3>
    <p class="text-sm leading-relaxed text-soft">
      Nothing to install. Click Open folder and pick a manga folder, or drag the folder onto the
      page. To read a single chapter right away, drag its <code>.cbz</code> onto the page.
    </p>
    <img src="/help/browser.png" alt="The Open folder button" class="w-full" />
  </section>

  <section class="space-y-3">
    <h3 class="text-lg font-bold text-soft">On your Android phone</h3>
    <p class="text-sm leading-relaxed text-soft">
      Download the
      <a href={downloads.android} class="border-b border-line-strong hover:border-fg/80">Android app</a>
      and install it. Open a chapter <code>.cbz</code> from your phone, or download manga from your computer
      (see "From your computer to your phone").
    </p>
    <div class="grid gap-3 sm:grid-cols-3">
      <img src="/help/home-mobile.jpeg" alt="Home screen of the Android app" class="w-full" />
      <img
        src="/help/manga-mobile.jpeg"
        alt="A manga's chapters in the Android app"
        class="w-full"
      />
      <img
        src="/help/reader-mobile.jpeg"
        alt="Reading a chapter in the Android app"
        class="w-full"
      />
    </div>
  </section>

  <section class="space-y-3">
    <h3 class="text-lg font-bold text-soft">On your computer</h3>
    <p class="text-sm leading-relaxed text-soft">
      Download the desktop app: the
      <a href={downloads.windows} class="border-b border-line-strong hover:border-fg/80"
        >Windows installer</a
      >
      and install it, or the
      <a href={downloads.linux} class="border-b border-line-strong hover:border-fg/80">Linux AppImage</a>,
      make it executable and run it. In Settings, pick your library folder. All your manga show up
      on the home screen.
    </p>
    <div class="space-y-3">
      <img src="/help/home-desktop.png" alt="The library in the desktop app" class="w-full" />
      <img
        src="/help/manga-desktop.png"
        alt="A manga's chapters in the desktop app"
        class="w-full"
      />
      <img
        src="/help/reader-desktop.png"
        alt="Reading a chapter in the desktop app"
        class="w-full"
      />
    </div>
  </section>

  <section class="space-y-3">
    <h3 class="text-lg font-bold text-soft">From your computer to your phone</h3>
    <p class="text-sm leading-relaxed text-soft">
      With the desktop app open and your phone on the same Wi-Fi, go to Settings → Share to LAN and
      scan the QR code with your phone's camera. The Android app must already be installed.
    </p>
  </section>

  <p class="text-sm leading-relaxed text-dim">
    Running it on a server with no screen (NAS, home server)? See the
    <a href={README} class="border-b border-line-strong hover:border-fg/80">README</a>.
  </p>

  <h2 id="preparing" class="pt-4 text-xl font-bold">Preparing your manga</h2>

  <section class="space-y-3">
    <h3 class="text-lg font-bold text-soft">How your manga must be laid out</h3>
    <ul class="list-inside list-disc space-y-2 text-sm leading-relaxed text-soft">
      <li>
        <b>One folder per manga.</b> The folder's name is used as the title if there is no metadata (see
        below).
      </li>
      <li>
        <b>One <code>.cbz</code> file per chapter</b>, directly inside the manga folder. A
        <code>.cbz</code> is a zip file full of page images, renamed. <code>.zip</code> works too. Anything
        else in the folder (loose images, subfolders, other files) is ignored.
      </li>
      <li>
        <b>A cover image</b> named <code>cover</code>: <code>cover.jpg</code>,
        <code>cover.png</code>, <code>cover.webp</code>… Optional.
      </li>
      <li>
        For the desktop app, put all your manga folders inside one folder, your library, and point
        the app at it.
      </li>
    </ul>
    <pre class="overflow-x-auto border border-line p-4 text-xs leading-relaxed">{folder}</pre>
  </section>

  <section class="space-y-3">
    <h3 class="text-lg font-bold text-soft">Chapter order and numbers</h3>
    <p class="text-sm leading-relaxed text-soft">
      Chapters are sorted by file name, letter by letter, so <code>10.cbz</code> comes before
      <code>2.cbz</code>. Pad numbers with zeros so they all have the same length:
      <code>001</code>, <code>002</code>, <code>010</code>.
    </p>
    <p class="text-sm leading-relaxed text-soft">
      Files named <code>chapter_0044-00.cbz</code> show as "Ch. 44", and
      <code>chapter_0044-05.cbz</code> as "Ch. 44.5". Any other name is shown as is.
    </p>
  </section>

  <section class="space-y-3">
    <h3 class="text-lg font-bold text-soft">Title, summary, authors, tags, status</h3>
    <p class="text-sm leading-relaxed text-soft">
      These come from a file named <code>ComicInfo.xml</code> inside the chapter <code>.cbz</code>
      files, next to the pages. It's a plain text file you can write in any text editor. Only the first
      and last chapters are read, so putting it in the first chapter is enough. Every field is optional:
    </p>
    <pre
      class="overflow-x-auto border border-line p-4 text-xs leading-relaxed">{comicInfo}</pre>
    <ul class="list-inside list-disc space-y-1 text-sm leading-relaxed text-soft">
      <li><code>Series</code>: title</li>
      <li><code>Summary</code>: description</li>
      <li><code>Year</code>: year</li>
      <li><code>Writer</code>, <code>Penciller</code>: authors, separated by commas</li>
      <li><code>Genre</code>, <code>Tags</code>: tags, separated by commas</li>
      <li>
        <code>Status</code>: <code>Ongoing</code>, <code>Complete</code>, <code>Hiatus</code>… Shown
        as is
      </li>
    </ul>
  </section>
</div>
