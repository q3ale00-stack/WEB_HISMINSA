// Caché simple en memoria con tiempo de vida (TTL) para optimizar consultas repetidas.
class MemoryCache {
  constructor() {
    this.cache = new Map();
  }

  // Obtiene un valor de la caché si no ha expirado.
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  // Guarda un valor en la caché con tiempo de expiración en segundos (por defecto 3 minutos).
  set(key, value, ttlSeconds = 180) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlSeconds * 1000)
    });
  }

  // Elimina una clave o un patrón de claves de la caché.
  del(key) {
    this.cache.delete(key);
  }

  // Invalida claves que coincidan con un prefijo.
  invalidatePrefix(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  // Limpia toda la caché.
  clear() {
    this.cache.clear();
  }
}

const memoryCache = new MemoryCache();

module.exports = memoryCache;
