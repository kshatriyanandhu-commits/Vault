"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { useSession } from "@/components/session-context";
import { useVaultKey } from "@/components/vault-key-context";
import { UnlockPrompt } from "@/components/vault/UnlockPrompt";
import { VaultView } from "@/components/vault/VaultView";
import { VaultScene } from "@/components/vault-scene/VaultScene";

export default function VaultPage() {
  const session = useSession();
  const vaultKey = useVaultKey();
  const router = useRouter();
  const user = session.state.status === "authenticated" ? session.state.user : null;

  useEffect(() => {
    if (session.state.status === "anonymous") {
      router.replace("/");
    }
  }, [session.state.status, router]);

  if (session.state.status === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="label-cap animate-led-pulse text-steel-500">
          verifying session…
        </p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="label-cap text-steel-500">redirecting to sealed vault…</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <AppHeader active="vault" showLock />
      <main className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
        {/* Left rail: live vault status + local activity history */}
        <aside className="w-full shrink-0 lg:w-[340px]">
          <VaultScene
            phase={vaultKey.key ? "open" : "locked"}
            className="h-[220px] w-full border border-steel-750 sm:h-[280px] lg:h-[320px]"
          />
          <div className="panel mt-4 rounded-sm p-4">
            <h2 className="label-cap mb-2">vault state</h2>
            <dl className="space-y-1.5 font-mono text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-steel-400">encryption</dt>
                <dd className="text-steel-200">AES-256-GCM</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-steel-400">key derivation</dt>
                <dd className="text-steel-200">PBKDF2-SHA-256</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-steel-400">key in memory</dt>
                <dd className={vaultKey.key ? "text-signal-green" : "text-signal-amber"}>
                  {vaultKey.key ? "loaded" : "cleared"}
                </dd>
              </div>
            </dl>
          </div>
        </aside>

        {/* Main: credentials (or re-unlock prompt) */}
        <section className="min-w-0 flex-1">
          {vaultKey.key ? (
            <VaultView user={user} />
          ) : (
            <UnlockPrompt user={user} />
          )}
        </section>
      </main>
    </div>
  );
}
