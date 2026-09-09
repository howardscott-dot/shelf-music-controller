declare const __SHELF_BUILD_ID__: string;

const CHECK_INTERVAL = 60_000;

export function startAppUpdateMonitor() {
  if (import.meta.env.DEV) return () => undefined;
  let stopped = false;
  let updating = false;
  let timer: number | undefined;

  const schedule = () => {
    window.clearTimeout(timer);
    if (!stopped) timer = window.setTimeout(check, CHECK_INTERVAL);
  };

  const showUpdate = () => {
    const notice = document.createElement('div');
    notice.className = 'app-update-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = 'UPDATING SHELF…';
    document.body.append(notice);
  };

  const check = async () => {
    if (stopped || updating || document.hidden) { schedule(); return; }
    try {
      const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Version unavailable');
      const value = await response.json() as { buildId?: string };
      if (value.buildId && value.buildId !== __SHELF_BUILD_ID__) {
        updating = true;
        showUpdate();
        const url = new URL(window.location.href);
        url.searchParams.set('v', value.buildId);
        window.setTimeout(() => window.location.replace(url), 120);
        return;
      }
    } catch { /* A temporary LAN outage must never interrupt playback. */ }
    schedule();
  };

  const onVisible = () => { if (!document.hidden) void check(); };
  const onPageShow = () => void check();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('online', onPageShow);
  timer = window.setTimeout(check, 1_500);

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('online', onPageShow);
  };
}
