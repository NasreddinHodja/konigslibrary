<script lang="ts">
  import { onMount } from 'svelte';
  import BackLink from '$lib/ui/BackLink.svelte';
  import { backOrHome, nativeBackOrHome } from '$lib/ui/back';
  import { fetchDownloadLinks, DEFAULT_DOWNLOAD_LINKS } from '$lib/utils/update';

  let downloads = $state(DEFAULT_DOWNLOAD_LINKS);

  onMount(async () => {
    downloads = await fetchDownloadLinks();
  });

  $effect(nativeBackOrHome);

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

<div class="mx-3 my-3 space-y-8 panel p-4 md:mx-auto md:my-8 md:max-w-2xl md:p-8">
  <BackLink label="back" onclick={backOrHome} />

  <h1 class="border-b border-ink text-2xl">how to use konigslibrary</h1>

  <p class="leading-relaxed">
    konigslibrary reads manga stored as <code>.cbz</code> files. Your folders have to follow the
    layout in
    <a href="#preparing" class="text-ink underline hover:text-hi">Preparing your manga</a>.
  </p>

  <h2 class="border-b border-ink pt-4 text-2xl">pick how you want to read</h2>

  <section class="space-y-3">
    <h3 class="underline">in this browser</h3>
    <p class="leading-relaxed">
      Nothing to install. Click Open folder and pick a manga folder, or drag the folder onto the
      page. To read a single chapter right away, drag its <code>.cbz</code> onto the page.
    </p>
    <img src="/help/browser.png" alt="The Open folder button" class="w-full" />
  </section>

  <section class="space-y-3">
    <h3 class="underline">on your Android phone</h3>
    <p class="leading-relaxed">
      Download the
      <a href={downloads.android} class="text-ink underline hover:text-hi">Android app</a>
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
    <h3 class="underline">on your computer</h3>
    <p class="leading-relaxed">
      Download the desktop app: the
      <a href={downloads.windows} class="text-ink underline hover:text-hi">Windows installer</a>
      and install it, or the
      <a href={downloads.linux} class="text-ink underline hover:text-hi">Linux AppImage</a>, make it
      executable and run it. In Settings, pick your library folder. All your manga show up on the
      home screen.
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
    <h3 class="underline">from your computer to your phone</h3>
    <p class="leading-relaxed">
      With the desktop app open and your phone on the same Wi-Fi, go to Settings → Library → Share
      to LAN. The first time, create the account your phone will log in with. Then enter the address
      it shows in the Android app's Settings, or open it in the phone's browser, and log in.
    </p>
  </section>

  <p class="leading-relaxed text-dim">
    Running it on a server with no screen (NAS, home server)? See the
    <a href={README} class="text-ink underline hover:text-hi">README</a>.
  </p>

  <h2 id="preparing" class="border-b border-ink pt-4 text-2xl">preparing your manga</h2>

  <section class="space-y-3">
    <h3 class="underline">how your manga must be laid out</h3>
    <ul class="list-inside list-disc space-y-2 leading-relaxed">
      <li>
        <span class="text-ink">One folder per manga.</span> The folder's name is used as the title if
        there is no metadata (see below).
      </li>
      <li>
        <span class="text-ink">One <code>.cbz</code> file per chapter</span>, directly inside the
        manga folder. A
        <code>.cbz</code> is a zip file full of page images, renamed. <code>.zip</code> works too. Anything
        else in the folder (loose images, subfolders, other files) is ignored.
      </li>
      <li>
        <span class="text-ink">A cover image</span> named <code>cover</code>:
        <code>cover.jpg</code>,
        <code>cover.png</code>, <code>cover.webp</code>… Optional.
      </li>
      <li>
        For the desktop app, put all your manga folders inside one folder, your library, and point
        the app at it.
      </li>
    </ul>
    <pre class="overflow-x-auto border border-ink p-3 leading-normal">{folder}</pre>
  </section>

  <section class="space-y-3">
    <h3 class="underline">chapter order and numbers</h3>
    <p class="leading-relaxed">
      Chapters are sorted by the volume and chapter numbers in their file names, so no renaming is
      needed: <code>Berserk v01 c003.cbz</code>, <code>Vol. 2 Ch. 12.5.cbz</code>,
      <code>chapter 7.cbz</code> and <code>053.cbz</code> all work, and <code>2.cbz</code> comes
      before
      <code>10.cbz</code>. Without a "chapter" or "volume" word, the last number in the name is the
      chapter. Numbers in brackets, like <code>(2016)</code> or <code>[Group]</code>, are skipped.
    </p>
    <p class="leading-relaxed">
      Volumes come first, then chapters not yet in a volume. Files with no number at all come last,
      by name. A <code>ComicInfo.xml</code> with <code>Volume</code> or <code>Number</code> (see below)
      overrides the numbers in the file name.
    </p>
    <p class="leading-relaxed">
      Files named <code>chapter_0044-00.cbz</code> show as "Ch. 44", and
      <code>chapter_0044-05.cbz</code> as "Ch. 44.5". Any other name is shown as is.
    </p>
  </section>

  <section class="space-y-3">
    <h3 class="underline">title, summary, authors, tags, status</h3>
    <p class="leading-relaxed">
      These come from a file named <code>ComicInfo.xml</code> inside the chapter <code>.cbz</code>
      files, next to the pages. It's a plain text file you can write in any text editor. Only the first
      and last chapters are read, so putting it in the first chapter is enough. Every field is optional:
    </p>
    <pre class="overflow-x-auto border border-ink p-3 leading-normal">{comicInfo}</pre>
    <ul class="list-inside list-disc space-y-1 leading-relaxed">
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

  <h2 class="border-b border-ink pt-4 text-2xl">credits</h2>
  <p class="leading-relaxed">
    The font is IBM VGA 9x16 from VileR's
    <a href="https://int10h.org/oldschool-pc-fonts/" class="text-ink underline hover:text-hi"
      >Ultimate Oldschool PC Font Pack</a
    >, under
    <a
      href="https://creativecommons.org/licenses/by-sa/4.0/"
      class="text-ink underline hover:text-hi">CC BY-SA 4.0</a
    >.
  </p>
  <p class="leading-relaxed">
    The icons are from
    <a href="https://github.com/the-moonwitch/Cozette" class="text-ink underline hover:text-hi"
      >Cozette</a
    >, under the MIT licence.
  </p>
</div>
