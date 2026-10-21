"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiRequestError, postJson } from "@/lib/api";
import {
  clearDevice,
  computeDeviceLabel,
  computeFingerprint,
  readDevice,
  writeDevice,
  type DeviceRecord,
} from "@/lib/activity";
import {
  createKeyCheck,
  deriveVaultKey,
  generateKdfSalt,
  verifyVaultKey,
  type EncryptedEnvelope,
} from "@/lib/crypto";
import type { PublicUser } from "@/lib/types";

export type SessionInfo = {
  id: string;
  status: "active" | "signed_out" | "revoked";
  signedInAt: string;
  lastSeenAt: string;
  expiresAt: string;
  deviceLabel: string | null;
};

export type AuthMaterial = {
  kdfSalt: string;
  kdfIterations: number;
  keyCheck: EncryptedEnvelope;
};

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | {
      status: "authenticated";
      user: PublicUser;
      session: SessionInfo;
      auth: AuthMaterial;
    };

export type SignInInput = {
  email: string;
  password: string;
  remember: boolean;
};

export type SignUpInput = {
  email: string;
  name: string;
  password: string;
};

type MeResponse = {
  user: PublicUser | null;
  session: SessionInfo | null;
  kdfSalt?: string;
  kdfIterations?: number;
  keyCheck?: EncryptedEnvelope;
};

type SessionApi = {
  state: SessionState;
  authMaterial: AuthMaterial | null;
  busy: boolean;
  refresh: () => Promise<void>;
  signIn: (input: SignInInput) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
  rememberedEmail: () => string | null;
  /** Derive + verify the vault key from the master password (never uploaded). */
  deriveKeyForSession: (password: string) => Promise<CryptoKey>;
};

const SessionContext = createContext<SessionApi | null>(null);

function devicePayload(email: string): {
  device: { id: string; label: string };
  fingerprint: string;
} {
  const existing: DeviceRecord | null = readDevice();
  // Reuse this browser's opaque device id so sessions correlate in the
  // admin ledger; the email is carried only for the "remember" record.
  const id = existing?.id ?? crypto.randomUUID();
  void email;
  return {
    device: { id, label: computeDeviceLabel() },
    fingerprint: computeFingerprint(),
  };
}

/** Pure fetch: resolves the current session state without touching React. */
async function fetchSessionState(): Promise<SessionState> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (res.status === 401) return { status: "anonymous" };
    const data = (await res.json()) as MeResponse;
    if (data.user && data.session && data.kdfSalt && data.keyCheck) {
      return {
        status: "authenticated",
        user: data.user,
        session: data.session,
        auth: {
          kdfSalt: data.kdfSalt,
          kdfIterations: data.kdfIterations ?? 600_000,
          keyCheck: data.keyCheck,
        },
      };
    }
    return { status: "anonymous" };
  } catch {
    return { status: "anonymous" };
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  // Mirror of the auth material outside React state. Callbacks such as
  // deriveKeyForSession run in the same tick that signIn()/signUp() resolve —
  // before React re-renders — so their closures would still see the previous
  // (anonymous) session. The ref is updated synchronously at every commit.
  const authRef = useRef<AuthMaterial | null>(null);
  const commitState = useCallback((next: SessionState) => {
    authRef.current = next.status === "authenticated" ? next.auth : null;
    setState(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const next = await fetchSessionState();
    if (mounted.current) commitState(next);
  }, [commitState]);

  // Restore an existing session on mount (promise callback, not a sync
  // setState inside the effect body).
  useEffect(() => {
    let cancelled = false;
    fetchSessionState().then((next) => {
      if (!cancelled && mounted.current) commitState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [commitState]);

  const signIn = useCallback(
    async ({ email, password, remember }: SignInInput) => {
      setBusy(true);
      try {
        const extra = devicePayload(email);
        const data = await postJson<{
          user: PublicUser;
          session: SessionInfo;
          kdfSalt: string;
          kdfIterations: number;
          keyCheck: EncryptedEnvelope;
        }>("/api/auth/signin", {
          email,
          password,
          remember,
          ...extra,
        });
        if (remember) {
          writeDevice({ id: extra.device.id, label: extra.device.label, email });
        } else {
          clearDevice();
        }
        if (!mounted.current) return;
        commitState({
          status: "authenticated",
          user: data.user,
          session: data.session,
          auth: {
            kdfSalt: data.kdfSalt,
            kdfIterations: data.kdfIterations,
            keyCheck: data.keyCheck,
          },
        });
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [commitState],
  );

  const signUp = useCallback(
    async ({ email, name, password }: SignUpInput) => {
      setBusy(true);
      try {
        const extra = devicePayload(email);
        const kdfSalt = generateKdfSalt();
        const iterations = 600_000;
        const key = await deriveVaultKey(password, kdfSalt, iterations);
        const keyCheck = await createKeyCheck(key);
        const data = await postJson<{
          user: PublicUser;
          session: SessionInfo;
          kdfSalt: string;
          kdfIterations: number;
          keyCheck: EncryptedEnvelope;
        }>("/api/auth/signup", {
          email,
          name,
          password,
          kdfSalt,
          keyCheck,
          ...extra,
        });
        if (!mounted.current) return;
        commitState({
          status: "authenticated",
          user: data.user,
          session: data.session,
          auth: {
            kdfSalt: data.kdfSalt,
            kdfIterations: data.kdfIterations,
            keyCheck: data.keyCheck,
          },
        });
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [commitState],
  );

  const signOut = useCallback(async () => {
    try {
      await postJson("/api/auth/signout");
    } catch (err) {
      // Network failure still clears local state below.
      if (!(err instanceof ApiRequestError)) {
        console.error("[argus] signout failed");
      }
    } finally {
      clearDevice();
      if (mounted.current) commitState({ status: "anonymous" });
    }
  }, [commitState]);

  const authMaterial: AuthMaterial | null =
    state.status === "authenticated" ? state.auth : null;

  const deriveKeyForSession = useCallback(
    async (password: string): Promise<CryptoKey> => {
      // Read the ref rather than `authMaterial`: callers invoke this in the
      // same tick that signIn() resolves, before React has re-rendered with
      // the authenticated state.
      const material = authRef.current;
      if (!material) {
        throw new Error("No authenticated session to unlock.");
      }
      const key = await deriveVaultKey(
        password,
        material.kdfSalt,
        material.kdfIterations,
      );
      const ok = await verifyVaultKey(key, material.keyCheck);
      if (!ok) {
        throw new Error("Incorrect master password.");
      }
      return key;
    },
    [],
  );

  const rememberedEmail = useCallback(() => readDevice()?.email ?? null, []);

  const api = useMemo<SessionApi>(
    () => ({
      state,
      authMaterial,
      busy,
      refresh,
      signIn,
      signUp,
      signOut,
      rememberedEmail,
      deriveKeyForSession,
    }),
    [
      state,
      authMaterial,
      busy,
      refresh,
      signIn,
      signUp,
      signOut,
      rememberedEmail,
      deriveKeyForSession,
    ],
  );

  return (
    <SessionContext.Provider value={api}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
