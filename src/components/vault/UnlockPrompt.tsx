"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useVaultKey } from "@/components/vault-key-context";
import type { PublicUser } from "@/lib/types";

/**
 * Re-derives the in-memory vault key after a session restore.
 * This is a purely local operation — the password never leaves the browser.
 */
export function UnlockPrompt({ user }: { user: PublicUser }) {
  const vaultKey = useVaultKey();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    const ok = await vaultKey.unlock(password);
    if (ok) setPassword("");
  }

  return (
    <div className="panel mx-auto max-w-md rounded-sm p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="led led-amber" aria-hidden />
        <div>
          <h1 className="font-mono text-base font-semibold tracking-wide text-steel-100">
            Vault sealed
          </h1>
          <p className="mt-0.5 text-xs text-steel-400">
            Signed in as {user.email}. Enter your master password to load your
            encryption key into this tab.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="unlock-password" className="label-cap mb-1.5 block">
            Master password
          </label>
          <div className="relative">
            <input
              id="unlock-password"
              ref={inputRef}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!vaultKey.unlockError}
              className="field-input pr-16"
              placeholder="••••••••••••"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm px-2 py-1 font-mono text-[0.62rem] tracking-widest text-steel-400 uppercase hover:text-signal-cyan focus-visible:outline-2 focus-visible:outline-signal-cyan"
              aria-pressed={showPassword}
            >
              {showPassword ? "hide" : "show"}
            </button>
          </div>
        </div>

        {vaultKey.unlockError && (
          <div role="alert" className="flex items-start gap-2 rounded-sm border border-signal-red-dim bg-[#200f0f] px-3 py-2">
            <span className="led led-red mt-1" aria-hidden />
            <p className="text-xs text-signal-red">{vaultKey.unlockError}</p>
          </div>
        )}

        <button type="submit" disabled={vaultKey.unlocking || !password} className="btn btn-primary w-full">
          {vaultKey.unlocking ? (
            <>
              <span className="led led-amber animate-led-pulse" aria-hidden />
              Deriving key…
            </>
          ) : (
            "Unlock vault"
          )}
        </button>
      </form>

      <p className="mt-5 text-[0.65rem] leading-relaxed text-steel-500">
        The key is derived locally with PBKDF2 (600k iterations) and verified
        against a non-secret check value. It stays in this tab&apos;s memory and
        is cleared when you lock the vault, sign out, or close the tab.
      </p>
    </div>
  );
}
