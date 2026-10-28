const CHECK_MS = 15 * 60 * 1000;
const RELOAD_KEY = 'kazari:reloaded-at';
const RELOAD_COOLDOWN_MS = 60 * 1000;
let reloadInProgress = false;

async function forceReload(): Promise<void> {
  if (reloadInProgress) return;
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
  reloadInProgress = true;
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // Still reload if Cache Storage or service workers are unavailable.
  }
  window.location.reload();
}

async function compareBuild(build: string | null): Promise<void> {
  if (import.meta.env.DEV || !build || build === 'dev' || build === __BUILD_ID__) return;
  await forceReload();
}

/** Called for every API response, including errors and file uploads. */
export function observeApiBuild(response: Response): void {
  void compareBuild(response.headers.get('X-Kazari-Build'));
}

/** Also checks on launch/resume and periodically when the app is idle. */
export function startVersionWatch(): () => void {
  if (import.meta.env.DEV) return () => undefined;
  const check = async () => {
    try {
      const response = await fetch('/api/version', { cache: 'no-store', credentials: 'include' });
      if (response.ok) {
        const payload = (await response.json()) as { build?: string };
        await compareBuild(payload.build || null);
      }
    } catch {
      // Offline: keep the installed shell and retry on the next request/resume.
    }
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') void check();
  };
  void check();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  const timer = window.setInterval(() => void check(), CHECK_MS);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    window.clearInterval(timer);
  };
}
