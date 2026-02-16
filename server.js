import { execSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';

process.env.PORT = String(port);
process.env.HOST = host;

// Start the SvelteKit server
const server = await import('./build/index.js');

// Print LAN addresses
const nets = networkInterfaces();
const addresses = [];
for (const name of Object.keys(nets)) {
  for (const net of nets[name] ?? []) {
    if (net.family === 'IPv4' && !net.internal) {
      addresses.push(net.address);
    }
  }
}

console.log(`\nKonigslibrary running on:`);
console.log(`  Local:   http://localhost:${port}`);
for (const addr of addresses) {
  console.log(`  Network: http://${addr}:${port}`);
}
console.log();

// Auto-open browser (best-effort, ignore errors)
const url = `http://localhost:${port}`;
try {
  const platform = process.platform;
  if (platform === 'win32') execSync(`start "" "${url}"`);
  else if (platform === 'darwin') execSync(`open "${url}"`);
  else execSync(`xdg-open "${url}"`);
} catch {
  // browser auto-open is optional
}
