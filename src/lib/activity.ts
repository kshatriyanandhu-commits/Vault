/**
 * Local (localStorage) activity history for vault actions.
 * Deliberately stores only action metadata — labels, field names, timestamps.
 * Never secrets, passwords, or key material.
 */

export const ACTIVITY_TYPES = [
  "unlock",
  "lock",
  "copy",
  "create",
  "edit",
  "delete",
  "signout",
  "failed_unlock",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export type ActivityEntry = {
  id: string;
  type: ActivityType;
  /** Credential label or account email — never a secret. */
  label?: string;
  /** Field name for copy events ("password", "username", …). */
  field?: string;
  at: number;
};

const PREFIX = "argus.activity.v1.";
const MAX_ENTRIES = 60;

function storageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

export function readActivity(userId: string): ActivityEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ActivityEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as ActivityEntry).id === "string" &&
        typeof (e as ActivityEntry).type === "string" &&
        typeof (e as ActivityEntry).at === "number",
    );
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------
   Tiny external store so React components can subscribe to activity
   changes via useSyncExternalStore (SSR snapshot = empty list).
------------------------------------------------------------------ */

const snapshotCache = new Map<string, readonly ActivityEntry[]>();
const listeners = new Map<string, Set<() => void>>();

function notify(userId: string): void {
  snapshotCache.delete(userId);
  for (const listener of listeners.get(userId) ?? []) listener();
}

export function subscribeActivity(userId: string, listener: () => void): () => void {
  let set = listeners.get(userId);
  if (!set) {
    set = new Set();
    listeners.set(userId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

export function getActivitySnapshot(userId: string): readonly ActivityEntry[] {
  let cached = snapshotCache.get(userId);
  if (!cached) {
    cached = readActivity(userId);
    snapshotCache.set(userId, cached);
  }
  return cached;
}

export function getActivityServerSnapshot(): readonly ActivityEntry[] {
  return EMPTY_LIST;
}

const EMPTY_LIST: readonly ActivityEntry[] = [];

export function pushActivity(
  userId: string,
  entry: Omit<ActivityEntry, "id" | "at"> & { at?: number },
): ActivityEntry[] {
  const entryWithMeta: ActivityEntry = {
    id:
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    at: entry.at ?? Date.now(),
    type: entry.type,
    label: entry.label,
    field: entry.field,
  };
  const next = [entryWithMeta, ...readActivity(userId)].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* storage full/blocked — activity is best-effort */
  }
  notify(userId);
  return next;
}

export function clearActivity(userId: string): void {
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
  notify(userId);
}

/** "device" record for the remember-this-device option. Holds no secrets. */
export type DeviceRecord = { id: string; label: string; email: string };
const DEVICE_KEY = "argus.device.v1";

export function readDevice(): DeviceRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEVICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceRecord;
    if (
      typeof parsed?.id !== "string" ||
      typeof parsed?.label !== "string" ||
      typeof parsed?.email !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeDevice(record: DeviceRecord): void {
  try {
    window.localStorage.setItem(DEVICE_KEY, JSON.stringify(record));
  } catch {
    /* ignore */
  }
}

export function clearDevice(): void {
  try {
    window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* ignore */
  }
}

/** Coarse, privacy-conscious device fingerprint. Display-only, never identity. */
export function computeDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Unknown device";
  const ua = navigator.userAgent;
  let browser = "Browser";
  if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = "OS";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return `${browser} on ${os}`;
}

/**
 * Coarse fingerprint: browser family + platform + coarse viewport + timezone.
 * Intentionally low-resolution; sent only as an untrusted display hint.
 */
export function computeFingerprint(): string {
  if (typeof navigator === "undefined") return "unknown";
  const parts = [
    computeDeviceLabel(),
    typeof navigator.hardwareConcurrency === "number"
      ? `c${Math.min(navigator.hardwareConcurrency, 32)}`
      : "c?",
    typeof screen !== "undefined"
      ? `s${Math.round(screen.width / 256) * 256}x${Math.round(screen.height / 256) * 256}`
      : "s?",
    Intl.DateTimeFormat().resolvedOptions().timeZone || "tz?",
  ];
  return parts.join("|").slice(0, 200);
}
