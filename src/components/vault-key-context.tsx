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
import { pushActivity } from "@/lib/activity";
import { useSession } from "./session-context";

type VaultKeyApi = {
  /** AES-GCM key object; lives in memory only, cleared on lock/sign-out. */
  key: CryptoKey | null;
  unlocking: boolean;
  unlockError: string | null;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
};

const VaultKeyContext = createContext<VaultKeyApi | null>(null);

export function VaultKeyProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const userId =
    session.state.status === "authenticated" ? session.state.user.id : null;

  // Drop the key whenever the user (or session) changes or ends.
  const prevUserId = useRef<string | null>(userId);
  useEffect(() => {
    if (prevUserId.current !== userId) {
      setKey(null);
      setUnlockError(null);
      prevUserId.current = userId;
    }
  }, [userId]);

  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      setUnlocking(true);
      setUnlockError(null);
      try {
        const derived = await session.deriveKeyForSession(password);
        setKey(derived);
        if (userId) {
          pushActivity(userId, { type: "unlock", label: "Vault unlocked" });
        }
        return true;
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Could not unlock the vault.";
        setUnlockError(message);
        if (userId) {
          pushActivity(userId, { type: "failed_unlock" });
        }
        return false;
      } finally {
        setUnlocking(false);
      }
    },
    [session, userId],
  );

  const lock = useCallback(() => {
    setKey(null);
    setUnlockError(null);
    if (userId) {
      pushActivity(userId, { type: "lock", label: "Vault locked" });
    }
  }, [userId]);

  const api = useMemo<VaultKeyApi>(
    () => ({ key, unlocking, unlockError, unlock, lock }),
    [key, unlocking, unlockError, unlock, lock],
  );

  return (
    <VaultKeyContext.Provider value={api}>{children}</VaultKeyContext.Provider>
  );
}

export function useVaultKey(): VaultKeyApi {
  const ctx = useContext(VaultKeyContext);
  if (!ctx) throw new Error("useVaultKey must be used within VaultKeyProvider");
  return ctx;
}
