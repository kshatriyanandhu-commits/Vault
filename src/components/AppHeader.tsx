"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/session-context";
import { useVaultKey } from "@/components/vault-key-context";
import { useToast } from "@/components/toast-context";
import { pushActivity } from "@/lib/activity";

type Props = {
  active: "vault" | "console";
  /** Lock button appears on the vault screen only. */
  showLock?: boolean;
};

export function AppHeader({ active, showLock = false }: Props) {
  const session = useSession();
  const vaultKey = useVaultKey();
  const toast = useToast();
  const router = useRouter();

  const user = session.state.status === "authenticated" ? session.state.user : null;

  async function handleSignOut() {
    const userId = user?.id;
    vaultKey.lock();
    await session.signOut();
    if (userId) pushActivity(userId, { type: "signout", label: "Signed out" });
    toast.push("Signed out", "info");
    router.replace("/");
  }

  function handleLock() {
    vaultKey.lock();
    toast.push("Vault locked — key cleared from memory", "info");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-steel-800 bg-steel-950/92 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-signal-cyan">
          <span
            className={`led ${vaultKey.key ? "led-green" : "led-amber"}`}
            aria-hidden
          />
          <span className="font-mono text-sm font-semibold tracking-[0.28em] text-steel-100">
            ARGUS&nbsp;VAULT
          </span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-1">
          <Link
            href="/vault"
            className={`rounded-sm px-3 py-1.5 font-mono text-[0.7rem] tracking-[0.14em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-signal-cyan ${
              active === "vault"
                ? "bg-steel-800 text-signal-cyan"
                : "text-steel-400 hover:text-steel-200"
            }`}
            aria-current={active === "vault" ? "page" : undefined}
          >
            Vault
          </Link>
          {user?.role === "admin" && (
            <Link
              href="/console"
              className={`rounded-sm px-3 py-1.5 font-mono text-[0.7rem] tracking-[0.14em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-signal-cyan ${
                active === "console"
                  ? "bg-steel-800 text-signal-cyan"
                  : "text-steel-400 hover:text-steel-200"
              }`}
              aria-current={active === "console" ? "page" : undefined}
            >
              Audit&nbsp;console
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {user && (
            <div className="hidden text-right sm:block">
              <p className="font-mono text-xs text-steel-200">{user.email}</p>
              <p className="label-cap mt-0.5">{user.role}</p>
            </div>
          )}
          {user?.role === "admin" && (
            <span className="chip border-signal-amber-dim text-signal-amber">
              admin
            </span>
          )}
          {showLock && (
            <button
              type="button"
              onClick={handleLock}
              disabled={!vaultKey.key}
              className="btn btn-ghost"
            >
              <span
                className={`led ${vaultKey.key ? "led-green" : "led-off"}`}
                aria-hidden
              />
              {vaultKey.key ? "Lock" : "Locked"}
            </button>
          )}
          <button type="button" onClick={handleSignOut} className="btn btn-ghost">
            Sign&nbsp;out
          </button>
        </div>
      </div>
    </header>
  );
}
