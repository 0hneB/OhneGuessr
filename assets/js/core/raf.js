// Run fn on the next animation frame and again after each settle delay (ms);
// with now:true it also runs synchronously first. Returns a cancel() for the
// pending frame and timers. Leaflet needs several passes to resync map size
// across CSS transitions, so callers fire a short burst rather than one pass.
export function rafBurst(fn, { now = false, delays = [] } = {}) {
  if (now) fn();
  const raf = requestAnimationFrame(fn);
  const timers = delays.map((d) => setTimeout(fn, d));
  return () => {
    cancelAnimationFrame(raf);
    for (const t of timers) clearTimeout(t);
  };
}
