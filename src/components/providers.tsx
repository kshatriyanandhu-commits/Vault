"use client";

import { SessionProvider } from "./session-context";
import { VaultKeyProvider } from "./vault-key-context";
import { ToastProvider } from "./toast-context";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SessionProvider>
        <VaultKeyProvider>{children}</VaultKeyProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
