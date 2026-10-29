const CHECK_MS = 15 * 60 * 1000;
const ATTEMPT_KEY = 'kazari:update-attempt';
let pendingBuild: string | null = null;
let checking = false;
let applying = false;

function attempted(build: string): boolean {
  try { return sessionStorage.getItem(ATTEMPT_KEY) === `${__BUILD_ID__}:${build}`; } catch { return false; }
}

async function checkVersion(): Promise<void> {
  if (import.meta.env.DEV || checking || pendingBuild) return;
  checking = true;
  try {
    const response = await fetch('/api/version', { cache: 'no-store', credentials: 'include' });
    if (!response.ok) return;
    const { build } = await response.json() as { build?: string };
    if (!build || build === 'dev' || build === __BUILD_ID__ || attempted(build)) return;
    pendingBuild = build;
    window.dispatchEvent(new CustomEvent('kazari:update-ready'));
  } catch {
    // Offline: retry on the next request or resume.
  } finally { checking = false; }
}

export function hasPendingVersionUpdate(): boolean { return pendingBuild !== null; }

/** Apply an update after the interface is safe to reload. */
export async function applyPendingVersionUpdate(): Promise<void> {
  if (!pendingBuild || applying) return;
  applying = true;
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (registration) {
        await registration.update();
        const worker = registration.installing || registration.waiting;
        if (worker && worker.state !== 'activated') {
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('Service worker update timed out')); }, 15000);
            const changed = () => {
              if (worker.state === 'activated' || worker.state === 'redundant') {
                window.clearTimeout(timeout);
                worker.removeEventListener('statechange', changed);
                if (worker.state === 'activated') resolve(); else reject(new Error('Service worker update failed'));
              }
            };
            worker.addEventListener('statechange', changed);
            changed();
          });
        }
      }
    }
    try { sessionStorage.setItem(ATTEMPT_KEY, `${__BUILD_ID__}:${pendingBuild}`); } catch { /* Storage can be unavailable. */ }
    window.location.reload();
  } catch {
    // Keep the current version and retry on the next check.
    pendingBuild = null;
    window.dispatchEvent(new CustomEvent('kazari:update-cancelled'));
  } finally { applying = false; }
}

/** A differing API header triggers a fresh confirmation, avoiding stale responses. */
export function observeApiBuild(response: Response): void {
  const build = response.headers.get('X-Kazari-Build');
  if (build && build !== 'dev' && build !== __BUILD_ID__) void checkVersion();
}

export function startVersionWatch(): () => void {
  if (import.meta.env.DEV) return () => undefined;
  const onVisible = () => { if (document.visibilityState === 'visible') void checkVersion(); };
  void checkVersion();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  const timer = window.setInterval(() => void checkVersion(), CHECK_MS);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
    window.clearInterval(timer);
  };
}
