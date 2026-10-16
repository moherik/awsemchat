type Schedule = (job: () => void, delay: number) => () => void;
const timer: Schedule = (job, delay) => {
  const handle = setTimeout(job, delay);
  return () => clearTimeout(handle);
};
export function createSyncScheduler(enabled: () => boolean, sync: () => Promise<{ more: boolean }>, schedule: Schedule = timer) {
  let cancel: (() => void) | undefined;
  let running = false, disposed = false;
  function queue(delay: number) {
    if (disposed || running || !enabled()) return;
    cancel = schedule(() => {
      cancel = undefined;
      if (disposed || !enabled()) return;
      running = true;
      let next = 5000;
      void sync().then(result => { if (result.more) next = 0; }, () => { next = 10000; })
        .finally(() => { running = false; queue(next); });
    }, delay);
  }
  return {
    refresh() { cancel?.(); cancel = undefined; queue(0); },
    dispose() { disposed = true; cancel?.(); cancel = undefined; },
  };
}
