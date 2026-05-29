import { isNative } from './platform';

const GITHUB_REPO = 'NasreddinHodja/konigslibrary';
const LS_DISMISSED = 'kl:update:dismissed';

export type UpdateInfo = {
  version: string;
  downloadUrl: string;
};

function newerThan(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isNative()) return null;
  if (!/android/i.test(navigator.userAgent)) return null;

  let current: string;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    current = await getVersion();
  } catch {
    return null;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!res.ok) return null;
    const data = await res.json();

    const latest = (data.tag_name as string).replace(/^v/, '');
    if (!newerThan(latest, current)) return null;
    if (localStorage.getItem(LS_DISMISSED) === latest) return null;

    const apk = (data.assets as { name: string; browser_download_url: string }[])?.find((a) =>
      a.name.endsWith('.apk')
    );
    return {
      version: latest,
      downloadUrl: apk?.browser_download_url ?? data.html_url
    };
  } catch {
    return null;
  }
}

export function dismissUpdate(version: string) {
  localStorage.setItem(LS_DISMISSED, version);
}
