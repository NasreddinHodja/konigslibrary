import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: process.env.TAURI_BUILD
      ? adapterStatic({ fallback: 'index.html', strict: false })
      : process.env.LOCAL_BUILD
        ? adapterNode()
        : adapterAuto(),
    serviceWorker: {
      register: !process.env.LOCAL_BUILD && !process.env.TAURI_BUILD
    }
  }
};

export default config;
