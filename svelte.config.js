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
    adapter:
      process.env.TAURI_BUILD || process.env.LOCAL_BUILD || process.env.STATIC_BUILD
        ? adapterStatic({ fallback: 'index.html', strict: false })
        : adapterAuto(),
    serviceWorker: {
      register: !process.env.LOCAL_BUILD && !process.env.TAURI_BUILD
    }
  }
};

export default config;
