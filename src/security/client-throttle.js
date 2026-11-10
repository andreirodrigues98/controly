// Protecao de experiencia, NAO seguranca da API. Usuario pode limpar storage.
// Limites efetivos sao de responsabilidade de Firebase Auth e do backend privilegiado.
export class ClientThrottle {
  constructor({ storage, now = () => Date.now(), namespace = 'controly.auth.v1' } = {}) {
    this.storage = storage;
    this.now = now;
    this.namespace = namespace;
    this.fallback = new Map();
  }
  _key(action) { return `${this.namespace}:${action}`; }
  _read(action) {
    const key = this._key(action);
    try {
      const value = this.storage?.getItem(key);
      if (value) return JSON.parse(value);
    } catch { /* armazenamento privado indisponivel */ }
    return this.fallback.get(key) || { timestamps: [], lockedUntil: 0 };
  }
  _write(action, value) {
    const key = this._key(action);
    this.fallback.set(key, value);
    try { this.storage?.setItem(key, JSON.stringify(value)); } catch { /* sem persistencia */ }
  }
  status(action, { limit, windowMs, lockMs }) {
    const now = this.now();
    const item = this._read(action);
    const timestamps = (Array.isArray(item.timestamps) ? item.timestamps : [])
      .filter((n) => Number.isFinite(n) && n > now - windowMs && n <= now);
    const lockedUntil = Number(item.lockedUntil) || 0;
    const retryAfterMs = lockedUntil > now ? lockedUntil - now : 0;
    if (timestamps.length !== item.timestamps?.length || (lockedUntil && !retryAfterMs)) {
      this._write(action, { timestamps, lockedUntil: retryAfterMs ? lockedUntil : 0 });
    }
    return { allowed: !retryAfterMs && timestamps.length < limit, retryAfterMs: retryAfterMs || (timestamps.length >= limit ? Math.max(0, timestamps[0] + windowMs - now) : 0), remaining: Math.max(0, limit - timestamps.length) };
  }
  record(action, { limit, windowMs, lockMs }) {
    const now = this.now();
    const status = this.status(action, { limit, windowMs, lockMs });
    if (!status.allowed) return status;
    const current = this._read(action);
    const timestamps = [...current.timestamps.filter((n) => n > now - windowMs && n <= now), now];
    this._write(action, { timestamps, lockedUntil: timestamps.length >= limit ? now + lockMs : 0 });
    return this.status(action, { limit, windowMs, lockMs });
  }
  clear(action) {
    this.fallback.delete(this._key(action));
    try { this.storage?.removeItem(this._key(action)); } catch { /* sem storage */ }
  }
}

export const AUTH_ACTION_POLICIES = Object.freeze({
  login: Object.freeze({ limit: 5, windowMs: 2 * 60_000, lockMs: 90_000 }),
  signup: Object.freeze({ limit: 3, windowMs: 60 * 60_000, lockMs: 5 * 60_000 }),
  reset: Object.freeze({ limit: 1, windowMs: 60_000, lockMs: 60_000 }),
  password: Object.freeze({ limit: 3, windowMs: 5 * 60_000, lockMs: 3 * 60_000 }),
});
