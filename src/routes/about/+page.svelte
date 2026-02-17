<script lang="ts">
  import { ArrowLeft } from 'lucide-svelte';
</script>

<div class="mx-auto max-w-2xl space-y-10 p-8">
  <a href="/" class="inline-flex items-center gap-2 text-sm opacity-60 hover:opacity-100">
    <ArrowLeft size={16} />
    Back
  </a>

  <h1 class="text-2xl font-bold">How to use Konigslibrary</h1>

  <section class="space-y-3">
    <h2 class="text-lg font-bold opacity-80">Browser only</h2>
    <p class="text-sm leading-relaxed opacity-70">
      Upload a ZIP or CBZ file and read it directly in your browser. No install needed, nothing
      leaves your device.
    </p>
  </section>

  <section class="space-y-3">
    <h2 class="text-lg font-bold opacity-80">Android app</h2>
    <p class="text-sm leading-relaxed opacity-70">
      Download the
      <a
        href="/download/konigslibrary.apk"
        download
        class="border-b border-white/40 hover:border-white/80">APK</a
      >, install it, and upload ZIPs directly on your phone.
    </p>
  </section>

  <section class="space-y-3">
    <h2 class="text-lg font-bold opacity-80">Local server + Android</h2>
    <p class="text-sm leading-relaxed opacity-70">
      Serve your manga library from your computer and browse it from any device on your network.
    </p>
    <ol class="list-inside list-decimal space-y-2 text-sm leading-relaxed opacity-70">
      <li>
        Download the server script for your OS:
        <a
          href="/download/konigslibrary.sh"
          download
          class="border-b border-white/40 hover:border-white/80">Linux / Mac</a
        >
        or
        <a
          href="/download/konigslibrary.bat"
          download
          class="border-b border-white/40 hover:border-white/80">Windows</a
        >
      </li>
      <li>Run the script &mdash; it handles Node.js, building, and starting the server</li>
      <li>Open the local URL in your browser and set your manga directory in Settings</li>
      <li>
        On your phone, install the
        <a
          href="/download/konigslibrary.apk"
          download
          class="border-b border-white/40 hover:border-white/80">APK</a
        >, enter your server's IP address (e.g.
        <code class="opacity-50">http://192.168.1.50:3000</code>), and browse your library
      </li>
    </ol>
  </section>
</div>
