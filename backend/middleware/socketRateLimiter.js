function createSocketLimiter({ windowMs, max }) {
  /** @type {Map<string, number[]>} key -> timestamps within the window */
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter((t) => now - t < windowMs);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }, Math.max(windowMs, 30_000));
  sweep.unref?.();

  return function consume(key) {
    const now = Date.now();
    const timestamps = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= max) {
      hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    return true;
  };
}

module.exports = { createSocketLimiter };