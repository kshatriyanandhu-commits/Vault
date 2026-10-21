"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { VaultScene } from "@/components/vault-scene/VaultScene";
import type { VaultPhase } from "@/components/vault-scene/vault-engine";
import { useSession } from "@/components/session-context";

/**
 * Sealed-vault screen: sign in / create account alongside the 3D vault.
 * The scene reacts to typing (dial spin), rejection (fault flash), and
 * successful sign-in (door opens before navigating into the app).
 */
export default function SealedVaultPage() {
  const session = useSession();
  const router = useRouter();
  const [phase, setPhase] = useState<VaultPhase>("sealed");
  const [dialTick, setDialTick] = useState(0);
  const initialResolve = useRef(true);
  const errorTimer = useRef<number | null>(null);

  // Restored session: skip the auth panel entirely.
  useEffect(() => {
    if (session.state.status === "loading") return;
    if (session.state.status === "authenticated" && initialResolve.current) {
      router.replace(session.state.user.role === "admin" ? "/console" : "/vault");
    }
    initialResolve.current = false;
  }, [session.state.status, session.state, router]);

  useEffect(
    () => () => {
      if (errorTimer.current) window.clearTimeout(errorTimer.current);
    },
    [],
  );

  const handleTyping = useCallback(() => {
    setDialTick((t) => t + 1);
    setPhase((prev) => (prev === "sealed" || prev === "typing" ? "typing" : prev));
  }, []);

  const handleReject = useCallback(() => {
    setPhase("error");
    if (errorTimer.current) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => {
      setPhase((prev) => (prev === "error" ? "sealed" : prev));
    }, 1700);
  }, []);

  const handleSuccess = useCallback(() => {
    if (errorTimer.current) window.clearTimeout(errorTimer.current);
    setPhase("unlocking");
    window.setTimeout(() => setPhase("open"), 350);
  }, []);

  const handleNavigate = useCallback(() => {
    const dest =
      session.state.status === "authenticated" &&
      session.state.user.role === "admin"
        ? "/console"
        : "/vault";
    router.push(dest);
  }, [router, session.state]);

  return (
    <main className="flex min-h-dvh flex-col lg:flex-row">
      {/* Scene — full-height backdrop on desktop, top band on mobile */}
      <section className="relative h-[36vh] min-h-[260px] w-full border-b border-steel-800 lg:h-dvh lg:flex-1 lg:border-r lg:border-b-0">
        <VaultScene
          phase={phase}
          dialTick={dialTick}
          className="h-full w-full rounded-none border-0"
        />
        <div className="pointer-events-none absolute right-4 bottom-4 hidden max-w-xs text-right lg:block">
          <p className="label-cap text-steel-500">
            argus vault · aes-256-gcm · client-side encryption
          </p>
        </div>
      </section>

      {/* Auth rail */}
      <section className="flex w-full flex-col overflow-y-auto bg-steel-950 lg:w-[480px] lg:h-dvh">
        <header className="flex items-center justify-between border-b border-steel-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="led led-green" aria-hidden />
            <div>
              <h1 className="font-mono text-sm font-semibold tracking-[0.3em] text-steel-100">
                ARGUS&nbsp;VAULT
              </h1>
              <p className="label-cap mt-0.5">credential vault</p>
            </div>
          </div>
          <span className="chip text-steel-400">v1.0</span>
        </header>

        <div className="flex flex-1 flex-col justify-center px-6 py-8">
          <AuthPanel
            onTyping={handleTyping}
            onReject={handleReject}
            onSuccess={handleSuccess}
            onNavigate={handleNavigate}
          />
        </div>

        <footer className="border-t border-steel-800 px-6 py-3">
          <p className="text-[0.68rem] leading-relaxed text-steel-500">
            Vault contents are encrypted in your browser with AES-256-GCM. Your
            master password is verified server-side to sign you in — it is never
            stored, and your vault key never leaves this device.
          </p>
        </footer>
      </section>
    </main>
  );
}
