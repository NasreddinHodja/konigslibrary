import { isAndroid, isNative } from './platform';

export const GITHUB_REPO = 'NasreddinHodja/konigslibrary';
const LS_DISMISSED = 'kl:update:dismissed';

export type UpdateInfo = {
  version: string;
  current: string;
  downloadUrl: string;
  /// The release's page, with its notes.
  notesUrl: string;
};

type Release = {
  tag_name: string;
  html_url: string;
  assets?: { name: string; browser_download_url: string }[];
};

/// The latest GitHub release, or `null` if it can't be fetched.
async function fetchLatestRelease(): Promise<Release | null> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
  return res.ok ? res.json() : null;
}

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
  if (!isAndroid()) return null;

  let current: string;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    current = await getVersion();
  } catch {
    return null;
  }

  try {
    const data = await fetchLatestRelease();
    if (!data) return null;

    const latest = data.tag_name.replace(/^v/, '');
    if (!newerThan(latest, current)) return null;
    if (localStorage.getItem(LS_DISMISSED) === latest) return null;

    const apk = data.assets?.find((a) => a.name.endsWith('.apk'));
    const downloadUrl: string = apk?.browser_download_url ?? data.html_url;
    if (!downloadUrl.startsWith('https://github.com/')) return null;
    if (!data.html_url.startsWith('https://github.com/')) return null;
    return { version: latest, current, downloadUrl, notesUrl: data.html_url };
  } catch {
    return null;
  }
}

export function dismissUpdate(version: string) {
  localStorage.setItem(LS_DISMISSED, version);
}

const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

export type DownloadLinks = { windows: string; linux: string; android: string };

/// The releases page for every platform, until the direct links are known.
export const DEFAULT_DOWNLOAD_LINKS: DownloadLinks = {
  windows: RELEASES_URL,
  linux: RELEASES_URL,
  android: RELEASES_URL
};

let downloadLinks: Promise<DownloadLinks> | null = null;

// Direct links to the latest release's assets, matched by extension since the
// file names carry the version. Falls back to the releases page. Fetched once
// per session: the GitHub API is rate-limited for anonymous callers.
export function fetchDownloadLinks(): Promise<DownloadLinks> {
  downloadLinks ??= loadDownloadLinks();
  return downloadLinks;
}

async function loadDownloadLinks(): Promise<DownloadLinks> {
  const links = DEFAULT_DOWNLOAD_LINKS;
  try {
    const data = await fetchLatestRelease();
    if (!data) return links;
    const assets = data.assets ?? [];
    const find = (ext: string) =>
      assets.find((a) => a.name.toLowerCase().endsWith(ext))?.browser_download_url;
    return {
      windows: find('.exe') ?? links.windows,
      linux: find('.appimage') ?? links.linux,
      android: find('.apk') ?? links.android
    };
  } catch {
    return links;
  }
}
