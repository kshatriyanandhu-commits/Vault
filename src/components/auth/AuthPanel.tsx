"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useSession } from "@/components/session-context";
import { useVaultKey } from "@/components/vault-key-context";
import { ApiRequestError } from "@/lib/api";
import { emailSchema, masterPasswordSchema, nameSchema } from "@/lib/validation";

type Props = {
  onTyping: () => void;
  onReject: () => void;
  onSuccess: () => void;
  onNavigate: () => void;
};

type FieldErrors = Partial<Record<"email" | "name" | "password" | "confirm", string>>;

export function AuthPanel({ onTyping, onReject, onSuccess, onNavigate }: Props) {
  const session = useSession();
  const vaultKey = useVaultKey();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(() => session.rememberedEmail() ?? "");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordHint = useMemo(() => {
    if (!password) return null;
    if (password.length < 10) return `${10 - password.length} more characters`;
    return `${password.length} characters · min 10`;
  }, [password]);

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setFieldErrors({});
    setFormError(null);
  }

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) {
      errs.email = parsedEmail.error.issues[0]?.message ?? "Invalid email.";
    }
    if (mode === "signup") {
      const parsedName = nameSchema.safeParse(name);
      if (!parsedName.success) {
        errs.name = parsedName.error.issues[0]?.message ?? "Invalid name.";
      }
      const parsedPw = masterPasswordSchema.safeParse(password);
      if (!parsedPw.success) {
        errs.password =
          parsedPw.error.issues[0]?.message ?? "Master password is too short.";
      } else if (
        password.toLowerCase().includes(parsedEmail.success ? parsedEmail.data.split("@")[0]! : "\u0000")
      ) {
        errs.password = "Master password should not contain your email.";
      }
      if (confirm !== password) {
        errs.confirm = "Passwords do not match.";
      }
    } else if (password.length === 0) {
      errs.password = "Master password is required.";
    }
    return errs;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      if (mode === "signin") {
        await session.signIn({ email: email.trim(), password, remember });
      } else {
        await session.signUp({
          email: email.trim(),
          name: name.trim(),
          password,
        });
      }
      // Derive the vault key immediately — we have the password in hand now.
      const unlocked = await vaultKey.unlock(password);
      if (!unlocked) {
        throw new Error("Vault key verification failed. Try signing in again.");
      }
      setPassword("");
      onSuccess();
      // Let the door-open animation play before routing into the app.
      window.setTimeout(onNavigate, 1250);
    } catch (err) {
      onReject();
      if (err instanceof ApiRequestError) {
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError("Sign-in failed. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || session.busy;

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-6">
        <h2 className="font-mono text-xl font-semibold tracking-wide text-steel-100">
          {mode === "signin" ? "Unlock your vault" : "Create your vault"}
        </h2>
        <p className="mt-1 text-sm text-steel-400">
          {mode === "signin"
            ? "Authenticate to decrypt your credentials in this browser."
            : "Your master password encrypts everything. It cannot be recovered."}
        </p>
      </div>

      {/* Mode switch */}
      <div
        role="tablist"
        aria-label="Authentication mode"
        className="mb-5 grid grid-cols-2 gap-1 rounded-sm border border-steel-750 bg-steel-900 p-1"
      >
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            type="button"
            onClick={() => switchMode(m)}
            className={`rounded-[2px] px-3 py-2 font-mono text-[0.7rem] tracking-[0.16em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-signal-cyan ${
              mode === m
                ? "bg-steel-750 text-signal-cyan shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "text-steel-400 hover:text-steel-200"
            }`}
          >
            {m === "signin" ? "Sign in" : "Create"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="auth-email" className="label-cap mb-1.5 block">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              onTyping();
            }}
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
            className="field-input"
            placeholder="operator@example.com"
            required
          />
          {fieldErrors.email && (
            <p id="auth-email-error" role="alert" className="mt-1 text-xs text-signal-red">
              {fieldErrors.email}
            </p>
          )}
        </div>

        {mode === "signup" && (
          <div>
            <label htmlFor="auth-name" className="label-cap mb-1.5 block">
              Name
            </label>
            <input
              id="auth-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                onTyping();
              }}
              aria-invalid={!!fieldErrors.name}
              className="field-input"
              placeholder="Ada Lovelace"
              required
            />
            {fieldErrors.name && (
              <p role="alert" className="mt-1 text-xs text-signal-red">
                {fieldErrors.name}
              </p>
            )}
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="auth-password" className="label-cap">
              Master password
            </label>
            {passwordHint && (
              <span className="text-[0.62rem] text-steel-500">{passwordHint}</span>
            )}
          </div>
          <div className="relative">
            <input
              id="auth-password"
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                onTyping();
              }}
              aria-invalid={!!fieldErrors.password}
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
          {fieldErrors.password && (
            <p role="alert" className="mt-1 text-xs text-signal-red">
              {fieldErrors.password}
            </p>
          )}
        </div>

        {mode === "signup" && (
          <div>
            <label htmlFor="auth-confirm" className="label-cap mb-1.5 block">
              Confirm master password
            </label>
            <input
              id="auth-confirm"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                onTyping();
              }}
              aria-invalid={!!fieldErrors.confirm}
              className="field-input"
              placeholder="••••••••••••"
              required
            />
            {fieldErrors.confirm && (
              <p role="alert" className="mt-1 text-xs text-signal-red">
                {fieldErrors.confirm}
              </p>
            )}
            <p className="mt-1.5 text-[0.68rem] leading-relaxed text-steel-500">
              There is no recovery: if you forget this password, your encrypted
              vault cannot be opened by anyone, including administrators.
            </p>
          </div>
        )}

        {mode === "signin" && (
          <label className="flex cursor-pointer items-start gap-2.5 select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#38dbe8]"
            />
            <span className="text-xs leading-snug text-steel-300">
              Remember this device
              <span className="mt-0.5 block text-[0.65rem] text-steel-500">
                Keeps you signed in for 30 days on this browser. Stores no
                password and no encryption key.
              </span>
            </span>
          </label>
        )}

        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-sm border border-signal-red-dim bg-[#200f0f] px-3 py-2"
          >
            <span className="led led-red mt-1" aria-hidden />
            <p className="text-xs leading-relaxed text-signal-red">{formError}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary w-full"
        >
          {busy ? (
            <>
              <span className="led led-amber animate-led-pulse" aria-hidden />
              {mode === "signin" ? "Verifying…" : "Forging vault…"}
            </>
          ) : mode === "signin" ? (
            "Sign in"
          ) : (
            "Create vault"
          )}
        </button>
      </form>

      <p className="mt-5 text-[0.65rem] leading-relaxed text-steel-500">
        Auth uses a server-side scrypt verifier — your master password crosses
        the wire at sign-in, but your AES-256 vault key is derived here in the
        browser and never uploaded. Credential contents are encrypted before
        they leave this device.
      </p>
    </div>
  );
}
