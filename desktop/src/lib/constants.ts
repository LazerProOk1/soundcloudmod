export const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.scdinternal.site';

// ── Direct mode: bypass scdinternal.site, talk straight to SoundCloud ─────────
export const DIRECT_SC_API_BASE = 'https://api-v2.soundcloud.com';

export const STREAMING_BASE =
  import.meta.env.VITE_STREAMING_BASE || 'https://stream.scdinternal.site';
export const STREAMING_PREMIUM_BASE =
  import.meta.env.VITE_STREAMING_PREMIUM_BASE || 'https://stream-premium.scdinternal.site';
export const IMAGES_BASE = import.meta.env.VITE_IMAGES_BASE || 'https://images.scdinternal.site';
export const STORAGE_BASE = import.meta.env.VITE_STORAGE_BASE || 'https://storage.scdinternal.site';
export const BYPASS_STORAGE_BASE =
  import.meta.env.VITE_BYPASS_STORAGE_BASE || 'https://white.storage.scdinternal.site';

export const BYPASS_API_BASE =
  import.meta.env.VITE_BYPASS_API_BASE || 'https://white.api.scdinternal.site';
export const BYPASS_STREAMING_BASE =
  import.meta.env.VITE_BYPASS_STREAMING_BASE || 'https://white.stream.scdinternal.site';
export const BYPASS_STREAMING_PREMIUM_BASE =
  import.meta.env.VITE_BYPASS_STREAMING_PREMIUM_BASE ||
  'https://white.stream-premium.scdinternal.site';
export const BYPASS_IMAGES_BASE =
  import.meta.env.VITE_BYPASS_IMAGES_BASE || 'https://white.images.scdinternal.site';

export const GITHUB_OWNER = 'LazerProOk1';
export const GITHUB_REPO = 'soundcloud_mod';
export const GITHUB_REPO_EN = 'soundcloud_mod';
export const APP_VERSION = __APP_VERSION__;

export const CHECK_UPDATES = false;

let _staticPort: number | null = null;
let _proxyPort: number | null = null;

export function setServerPorts(staticP: number, proxy: number) {
  _staticPort = staticP;
  _proxyPort = proxy;
}

export function getStaticPort(): number | null {
  return _staticPort;
}

export function getProxyPort(): number | null {
  return _proxyPort;
}
