import type { CapacitorConfig } from '@capacitor/cli';

const dev = !!process.env.CAP_DEV;

const config: CapacitorConfig = {
  appId: 'com.konigslibrary.app',
  appName: 'konigslibrary',
  webDir: 'build',
  server: {
    androidScheme: 'http',
    ...(dev && { url: 'http://10.0.2.2:5173', cleartext: true })
  }
};

export default config;
