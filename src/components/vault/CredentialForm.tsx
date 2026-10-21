"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { CATEGORIES, CATEGORY_LABELS, credentialInputSchema } from "@/lib/validation";
import type { CredentialRecord } from "@/lib/types";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  initial?: CredentialRecord | null;
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (values: CredentialRecord) => void | Promise<void>;
};

const EMPTY: CredentialRecord = {
  label: "",
  category: "login",
  username: "",
  password: "",
  url: "",
  notes: "",
};

const CHARSET =
  "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+";

function generatePassword(length = 20): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += CHARSET[b % CHARSET.length];
  return out;
}

export function CredentialForm({
  open,
  mode,
  initial,
  submitting = false,
  onCancel,
  onSubmit,
}: Props) {
  return (
    <Modal
      open={open}
      title={mode === "create" ? "Add credential" : "Edit credential"}
      onClose={onCancel}
      maxWidth="max-w-xl"
    >
      {/* Mounted fresh on every open — no reset effect needed. */}
      <CredentialFormFields
        initial={initial ?? EMPTY}
        submitLabel={mode === "create" ? "Seal into vault" : "Save changes"}
        submitting={submitting}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}

function CredentialFormFields({
  initial,
  submitLabel,
  submitting,
  onCancel,
  onSubmit,
}: {
  initial: CredentialRecord;
  submitLabel: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: CredentialRecord) => void | Promise<void>;
}) {
  const [values, setValues] = useState<CredentialRecord>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isNote = values.category === "note";

  function set<K extends keyof CredentialRecord>(key: K, value: CredentialRecord[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = credentialInputSchema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    await onSubmit(parsed.data);
  }

  const strength = useMemo(() => {
    const pw = values.password;
    if (!pw) return null;
    let score = 0;
    if (pw.length >= 12) score++;
    if (pw.length >= 20) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    const label = score <= 2 ? "weak" : score === 3 ? "fair" : score === 4 ? "strong" : "very strong";
    const color = score <= 2 ? "bg-signal-red" : score === 3 ? "bg-signal-amber" : "bg-signal-green";
    return { score, label, color };
  }, [values.password]);

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="cred-label" className="label-cap mb-1.5 block">
              Label
            </label>
            <input
              id="cred-label"
              className="field-input"
              value={values.label}
              onChange={(e) => set("label", e.target.value)}
              aria-invalid={!!errors.label}
              placeholder="Production AWS root"
              maxLength={120}
              autoFocus
              required
            />
            {errors.label && (
              <p role="alert" className="mt-1 text-xs text-signal-red">
                {errors.label}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="cred-category" className="label-cap mb-1.5 block">
              Category
            </label>
            <select
              id="cred-category"
              className="field-input"
              value={values.category}
              onChange={(e) => set("category", e.target.value as CredentialRecord["category"])}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="cred-username" className="label-cap mb-1.5 block">
              {isNote ? "Reference (optional)" : "Username"}
            </label>
            <input
              id="cred-username"
              className="field-input"
              value={values.username}
              onChange={(e) => set("username", e.target.value)}
              aria-invalid={!!errors.username}
              maxLength={200}
              spellCheck={false}
              autoComplete="off"
              placeholder={isNote ? "e.g. ticket REF-1234" : "operator@example.com"}
            />
            {errors.username && (
              <p role="alert" className="mt-1 text-xs text-signal-red">
                {errors.username}
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <div className="mb-1.5 flex items-baseline justify-between">
              <label htmlFor="cred-password" className="label-cap">
                {isNote ? "Secret (optional)" : "Password / secret"}
              </label>
              <button
                type="button"
                onClick={() => set("password", generatePassword())}
                className="font-mono text-[0.62rem] tracking-widest text-signal-cyan uppercase hover:underline focus-visible:outline-2 focus-visible:outline-signal-cyan"
              >
                generate
              </button>
            </div>
            <input
              id="cred-password"
              className="field-input"
              value={values.password}
              onChange={(e) => set("password", e.target.value)}
              aria-invalid={!!errors.password}
              maxLength={4000}
              spellCheck={false}
              autoComplete="new-password"
              placeholder="••••••••••••"
            />
            {errors.password && (
              <p role="alert" className="mt-1 text-xs text-signal-red">
                {errors.password}
              </p>
            )}
            {strength && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-steel-800">
                  <div
                    className={`h-full ${strength.color}`}
                    style={{ width: `${(strength.score / 5) * 100}%` }}
                  />
                </div>
                <span className="label-cap text-steel-400">{strength.label}</span>
              </div>
            )}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="cred-url" className="label-cap mb-1.5 block">
              URL (optional)
            </label>
            <input
              id="cred-url"
              className="field-input"
              value={values.url}
              onChange={(e) => set("url", e.target.value)}
              aria-invalid={!!errors.url}
              maxLength={500}
              spellCheck={false}
              inputMode="url"
              placeholder="https://console.example.com"
            />
            {errors.url && (
              <p role="alert" className="mt-1 text-xs text-signal-red">
                {errors.url}
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="cred-notes" className="label-cap mb-1.5 block">
              Notes (optional)
            </label>
            <textarea
              id="cred-notes"
              className="field-input min-h-[88px] resize-y"
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
              aria-invalid={!!errors.notes}
              maxLength={4000}
              placeholder="Recovery codes, PINs, instructions…"
            />
            <p className="mt-1 text-right text-[0.62rem] text-steel-500">
              {values.notes.length}/4000
            </p>
            {errors.notes && (
              <p role="alert" className="mt-1 text-xs text-signal-red">
                {errors.notes}
              </p>
            )}
          </div>
        </div>

        <p className="text-[0.65rem] leading-relaxed text-steel-500">
          This record is encrypted with AES-256-GCM in your browser before
          upload. The server only ever stores ciphertext.
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn btn-primary">
            {submitting ? "Encrypting…" : submitLabel}
          </button>
        </div>
      </form>
    </>
  );
}
