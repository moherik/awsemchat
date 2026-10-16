type Schedule = (job: () => void, delay: number) => () => void;
const timeout: Schedule = (job, delay) => {
  const handle = setTimeout(job, delay);
  return () => clearTimeout(handle);
};

export function createNowPlayingLifecycle(ports: {
  enabled(): boolean;
  sync(): Promise<unknown>;
  interval: number;
  schedule?: Schedule;
}) {
  const schedule = ports.schedule ?? timeout;
  let cancel: (() => void) | undefined;
  let running = false;
  let disposed = false;
  let requested = false;

  function queue() {
    if (disposed || running || !ports.enabled()) return;
    cancel = schedule(() => {
      cancel = undefined;
      if (disposed || !ports.enabled()) return;
      running = true;
      void ports.sync().catch(() => {}).finally(() => {
        running = false;
        if (requested) { requested = false; void run(); return; }
        queue();
      });
    }, ports.interval);
  }

  function run() {
    if (disposed || !ports.enabled()) return;
    if (running) { requested = true; return; }
    running = true;
    void ports.sync().catch(() => {}).finally(() => {
      running = false;
      if (requested) { requested = false; void run(); return; }
      queue();
    });
  }

  return Object.freeze({
    refresh() { cancel?.(); cancel = undefined; run(); },
    dispose() { disposed = true; requested = false; cancel?.(); cancel = undefined; },
  });
}
