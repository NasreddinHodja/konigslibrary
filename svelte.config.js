import adapterAuto from '@sveltejs/adapter-auto';
import adapterStatic from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // LOCAL_BUILD used to mean adapter-node, because the API lived in
    // src/routes/api/**. Those handlers are now the konigslibrary-server
    // binary, so the local build is plain static assets that binary serves —
    // same output shape as the Tauri build. STATIC_BUILD is the public
    // Vercel site: also backend-free (no src/routes/api/** to route SSR to),
    // but unlike LOCAL_BUILD it has no origin API standing behind it, so it
    // keeps the service worker registered for offline/PWA use.
    //
    // LOCAL_BUILD gets its own output directory (build-local/, see
    // KL_STATIC_DIR in konigslibrary.service and static_dir() in
    // crates/klserver/src/main.rs) rather than sharing build/ with the
    // Tauri/website builds — those are one-shot (consumed once at their own
    // build time), but the local server keeps re-reading its directory from
    // disk for as long as it runs, so a later unrelated build overwriting
    // build/ would silently swap out what it serves.
    adapter: process.env.LOCAL_BUILD
      ? adapterStatic({ fallback: 'index.html', strict: false, pages: 'build-local', assets: 'build-local' })
      : process.env.TAURI_BUILD || process.env.STATIC_BUILD
        ? adapterStatic({ fallback: 'index.html', strict: false })
        : adapterAuto(),
    serviceWorker: {
      register: !process.env.LOCAL_BUILD && !process.env.TAURI_BUILD
    }
  }
};

export default config;
