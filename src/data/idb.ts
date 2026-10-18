// Minimaler IndexedDB-Key-Value-Speicher (ohne Abhängigkeiten), mit localStorage-Fallback.

const DB_NAME = 'areapro';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const memory = new Map<string, unknown>();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) {
    try {
      const raw = localStorage.getItem(`${DB_NAME}:${key}`);
      return raw ? (JSON.parse(raw) as T) : (memory.get(key) as T | undefined);
    } catch {
      return memory.get(key) as T | undefined;
    }
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.set(key, value);
    try {
      localStorage.setItem(`${DB_NAME}:${key}`, JSON.stringify(value));
    } catch {
      /* Speicher voll / blockiert → nur im Speicher */
    }
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function kvDel(key: string): Promise<void> {
  const db = await openDb();
  memory.delete(key);
  try {
    localStorage.removeItem(`${DB_NAME}:${key}`);
  } catch {
    /* ignore */
  }
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Persistenten Speicher anfordern, damit iOS/Safari lokale Daten nicht vorschnell verwirft. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}
