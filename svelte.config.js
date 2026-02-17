import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';

const isCapacitor = !!process.env.CAPACITOR_BUILD;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: isCapacitor
      ? adapterStatic({ fallback: 'index.html', strict: false })
      : process.env.LOCAL_BUILD
        ? adapterNode()
        : adapterAuto(),
    serviceWorker: {
      register: !isCapacitor
    }
  }
};

export default config;
