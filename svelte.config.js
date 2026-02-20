import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: process.env.LOCAL_BUILD ? adapterNode() : adapterAuto(),
    serviceWorker: {
      register: !process.env.LOCAL_BUILD
    }
  }
};

export default config;
