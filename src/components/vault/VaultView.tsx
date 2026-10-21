"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useVaultKey } from "@/components/vault-key-context";
import { useToast } from "@/components/toast-context";
import { CredentialForm } from "./CredentialForm";
import { apiFetch, ApiRequestError, delJson, postJson, putJson } from "@/lib/api";
import {
  decryptPayload,
  encryptPayload,
  credentialAad,
} from "@/lib/crypto";
import {
  clearActivity,
  getActivityServerSnapshot,
  getActivitySnapshot,
  pushActivity,
  subscribeActivity,
  type ActivityEntry,
} from "@/lib/activity";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
} from "@/lib/validation";
import type { CredentialDto, CredentialRecord, PublicUser } from "@/lib/types";

type VaultItem = {
  dto: CredentialDto;
  record: CredentialRecord | null;
  corrupt: boolean;
};

const ACTIVITY_META: Record<ActivityEntry["type"], { label: string; led: string }> = {
  unlock: { label: "unlocked", led: "led-green" },
  lock: { label: "locked", led: "led-amber" },
  copy: { label: "copied", led: "led-cyan" },
  create: { label: "created", led: "led-green" },
  edit: { label: "edited", led: "led-amber" },
  delete: { label: "deleted", led: "led-red" },
  signout: { label: "signed out", led: "led-off" },
  failed_unlock: { label: "unlock failed", led: "led-red" },
};

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function VaultView({ user }: { user: PublicUser }) {
  const vaultKey = useVaultKey();
  const toast = useToast();
  const key = vaultKey.key;

  const [items, setItems] = useState<VaultItem[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<VaultItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VaultItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const subscribe = useCallback(
    (cb: () => void) => subscribeActivity(user.id, cb),
    [user.id],
  );
  const getActivity = useCallback(() => getActivitySnapshot(user.id), [user.id]);
  const activity = useSyncExternalStore(
    subscribe,
    getActivity,
    getActivityServerSnapshot,
  );

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      setLoadState("loading");
      setLoadError(null);
      try {
        const data = await apiFetch<{ credentials: CredentialDto[] }>(
          "/api/credentials",
        );
        const decrypted = await Promise.all(
          data.credentials.map(async (dto): Promise<VaultItem> => {
            try {
              const record = await decryptPayload<CredentialRecord>(
                key,
                { ciphertext: dto.ciphertext, iv: dto.iv },
                credentialAad(user.id, dto.id),
              );
              return { dto, record, corrupt: false };
            } catch {
              return { dto, record: null, corrupt: true };
            }
          }),
        );
        if (!cancelled) {
          setItems(decrypted);
          setLoadState("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiRequestError
              ? err.message
              : "Could not reach the vault service.",
          );
          setLoadState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, user.id, reloadToken]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter !== "all" && item.record?.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const r = item.record;
      if (!r) return false;
      return (
        r.label.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q) ||
        r.notes.toLowerCase().includes(q)
      );
    });
  }, [items, query, categoryFilter]);

  const counts = useMemo(() => {
    const byCategory = new Map<Category, number>();
    for (const item of items) {
      if (item.record) {
        byCategory.set(
          item.record.category,
          (byCategory.get(item.record.category) ?? 0) + 1,
        );
      }
    }
    return byCategory;
  }, [items]);

  async function copyField(item: VaultItem, field: "password" | "username" | "url" | "notes") {
    const value = item.record?.[field];
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        toast.push("Clipboard unavailable in this browser", "error");
      }
      document.body.removeChild(ta);
    }
    pushActivity(user.id, { type: "copy", label: item.record?.label, field });
    toast.push(`${field} copied to clipboard`, "success");
  }

  async function handleSave(values: CredentialRecord) {
    if (!key) return;
    setSaving(true);
    try {
      if (editing) {
        const envelope = await encryptPayload(
          key,
          values,
          credentialAad(user.id, editing.dto.id),
        );
        const data = await putJson<{ credential: CredentialDto }>(
          `/api/credentials/${editing.dto.id}`,
          { id: editing.dto.id, ...envelope },
        );
        setItems((prev) =>
          prev.map((i) =>
            i.dto.id === editing.dto.id
              ? { dto: data.credential, record: values, corrupt: false }
              : i,
          ),
        );
        pushActivity(user.id, { type: "edit", label: values.label });
        toast.push("Credential updated", "success");
      } else {
        const id = crypto.randomUUID();
        const envelope = await encryptPayload(key, values, credentialAad(user.id, id));
        const data = await postJson<{ credential: CredentialDto }>("/api/credentials", {
          id,
          ...envelope,
        });
        setItems((prev) => [
          { dto: data.credential, record: values, corrupt: false },
          ...prev,
        ]);
        pushActivity(user.id, { type: "create", label: values.label });
        toast.push("Credential sealed into vault", "success");
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      toast.push(
        err instanceof ApiRequestError ? err.message : "Could not save credential.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await delJson(`/api/credentials/${pendingDelete.dto.id}`);
      const label = pendingDelete.record?.label;
      setItems((prev) => prev.filter((i) => i.dto.id !== pendingDelete.dto.id));
      pushActivity(user.id, { type: "delete", label });
      toast.push("Credential destroyed", "success");
      setPendingDelete(null);
    } catch (err) {
      toast.push(
        err instanceof ApiRequestError ? err.message : "Could not delete credential.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="panel flex flex-wrap items-center gap-3 rounded-sm p-3">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="vault-search" className="sr-only">
            Search credentials
          </label>
          <input
            id="vault-search"
            type="search"
            className="field-input"
            placeholder="Search label, username, URL, notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="vault-category" className="sr-only">
            Filter by category
          </label>
          <select
            id="vault-category"
            className="field-input w-auto"
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as Category | "all")
            }
          >
            <option value="all">
              All categories ({items.length})
            </option>
            {CATEGORIES.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]} ({counts.get(c) ?? 0})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          + Add credential
        </button>
      </div>

      {/* Body states */}
      {loadState === "loading" && (
        <div className="mt-6 space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel relative h-20 overflow-hidden rounded-sm">
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-steel-800/60 to-transparent animate-sweep" />
            </div>
          ))}
          <p className="label-cap text-center text-steel-500">decrypting vault…</p>
        </div>
      )}

      {loadState === "error" && (
        <div className="panel mt-6 flex flex-col items-start gap-3 rounded-sm border-signal-red-dim p-5">
          <div className="flex items-center gap-2">
            <span className="led led-red" aria-hidden />
            <p className="font-mono text-sm text-signal-red">Vault unavailable</p>
          </div>
          <p className="text-xs text-steel-300">{loadError}</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setReloadToken((t) => t + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {loadState === "ready" && filtered.length === 0 && (
        <div className="panel mt-6 rounded-sm p-10 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full border border-dashed border-steel-600" />
          <p className="font-mono text-sm text-steel-200">
            {items.length === 0 ? "Your vault is empty" : "No matches"}
          </p>
          <p className="mt-1 text-xs text-steel-400">
            {items.length === 0
              ? "Add your first credential — it is encrypted before it leaves this device."
              : "Adjust your search or category filter."}
          </p>
          {items.length === 0 && (
            <button
              type="button"
              className="btn btn-primary mt-4"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              + Add credential
            </button>
          )}
        </div>
      )}

      {loadState === "ready" && filtered.length > 0 && (
        <ul className="mt-4 grid gap-3 xl:grid-cols-2">
          {filtered.map((item) => (
            <CredentialCard
              key={item.dto.id}
              item={item}
              revealed={!!revealed[item.dto.id]}
              expanded={!!expanded[item.dto.id]}
              onToggleReveal={() =>
                setRevealed((prev) => ({ ...prev, [item.dto.id]: !prev[item.dto.id] }))
              }
              onToggleExpand={() =>
                setExpanded((prev) => ({ ...prev, [item.dto.id]: !prev[item.dto.id] }))
              }
              onCopy={(field) => void copyField(item, field)}
              onEdit={() => {
                setEditing(item);
                setFormOpen(true);
              }}
              onDelete={() => setPendingDelete(item)}
            />
          ))}
        </ul>
      )}

      {/* Local activity history */}
      <section className="panel mt-6 rounded-sm p-4" aria-label="Local activity history">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label-cap">local activity (this device only)</h2>
          {activity.length > 0 && (
            <button
              type="button"
              className="font-mono text-[0.62rem] tracking-widest text-steel-400 uppercase hover:text-steel-200 focus-visible:outline-2 focus-visible:outline-signal-cyan"
              onClick={() => clearActivity(user.id)}
            >
              clear
            </button>
          )}
        </div>
        {activity.length === 0 ? (
          <p className="text-xs text-steel-500">
            Actions in this vault (unlock, copy, edit…) appear here. History is
            stored in this browser only — never on the server.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {activity.slice(0, 14).map((entry) => {
              const meta = ACTIVITY_META[entry.type];
              return (
                <li key={entry.id} className="flex items-center gap-2.5 font-mono text-xs">
                  <span className={`led ${meta.led}`} aria-hidden />
                  <span className="text-steel-300">{meta.label}</span>
                  {entry.label && (
                    <span className="min-w-0 truncate text-steel-100">
                      “{entry.label}”
                      {entry.field ? ` · ${entry.field}` : ""}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-steel-500">
                    {timeAgo(entry.at)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Create / edit modal */}
      <CredentialForm
        open={formOpen}
        mode={editing ? "edit" : "create"}
        initial={editing?.record ?? null}
        submitting={saving}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSave}
      />

      {/* Delete confirmation */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !deleting) setPendingDelete(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm deletion"
            className="panel animate-rise w-full max-w-sm rounded-sm p-5"
          >
            <h2 className="font-mono text-sm font-semibold text-signal-red">
              Destroy credential?
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-steel-300">
              <span className="text-steel-100">
                {pendingDelete.record?.label ?? "This credential"}
              </span>{" "}
              will be permanently deleted from the server. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? "Deleting…" : "Destroy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CredentialCard({
  item,
  revealed,
  expanded,
  onToggleReveal,
  onToggleExpand,
  onCopy,
  onEdit,
  onDelete,
}: {
  item: VaultItem;
  revealed: boolean;
  expanded: boolean;
  onToggleReveal: () => void;
  onToggleExpand: () => void;
  onCopy: (field: "password" | "username" | "url" | "notes") => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { record, corrupt } = item;

  if (corrupt || !record) {
    return (
      <li className="panel rounded-sm border-signal-red-dim p-4">
        <div className="flex items-center gap-2">
          <span className="led led-red" aria-hidden />
          <p className="font-mono text-sm text-steel-200">Undecryptable record</p>
        </div>
        <p className="mt-1.5 text-xs text-steel-400">
          This item could not be decrypted with your current key
          (id {item.dto.id.slice(0, 8)}…). It may have been encrypted with a
          different master password.
        </p>
        <button type="button" className="btn btn-danger mt-3" onClick={onDelete}>
          Delete record
        </button>
      </li>
    );
  }

  return (
    <li className="panel rounded-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip border-steel-600 text-steel-300">
              {CATEGORY_LABELS[record.category]}
            </span>
            {record.url && (
              <a
                href={record.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-mono text-[0.68rem] text-signal-cyan hover:underline"
              >
                {record.url.replace(/^https?:\/\//, "").slice(0, 40)}
              </a>
            )}
          </div>
          <h3 className="mt-1.5 truncate font-mono text-sm font-semibold text-steel-100">
            {record.label}
          </h3>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="btn btn-ghost px-2.5 py-1.5"
            aria-label={`Edit ${record.label}`}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="btn btn-danger px-2.5 py-1.5"
            aria-label={`Delete ${record.label}`}
          >
            Delete
          </button>
        </div>
      </div>

      <dl className="mt-3 space-y-2">
        {record.username && (
          <div className="flex items-center gap-2">
            <dt className="label-cap w-20 shrink-0">user</dt>
            <dd className="mono-data min-w-0 flex-1 truncate text-xs text-steel-200">
              {record.username}
            </dd>
            <button
              type="button"
              onClick={() => onCopy("username")}
              className="btn btn-ghost px-2 py-1 text-[0.62rem]"
              aria-label={`Copy username of ${record.label}`}
            >
              copy
            </button>
          </div>
        )}
        {record.password && (
          <div className="flex items-center gap-2">
            <dt className="label-cap w-20 shrink-0">secret</dt>
            <dd className="mono-data min-w-0 flex-1 truncate text-xs text-steel-200">
              {revealed ? record.password : "•".repeat(Math.min(record.password.length, 24))}
            </dd>
            <button
              type="button"
              onClick={onToggleReveal}
              className="btn btn-ghost px-2 py-1 text-[0.62rem]"
              aria-pressed={revealed}
              aria-label={`${revealed ? "Hide" : "Reveal"} secret of ${record.label}`}
            >
              {revealed ? "hide" : "reveal"}
            </button>
            <button
              type="button"
              onClick={() => onCopy("password")}
              className="btn btn-ghost px-2 py-1 text-[0.62rem]"
              aria-label={`Copy secret of ${record.label}`}
            >
              copy
            </button>
          </div>
        )}
      </dl>

      {record.notes && (
        <div className="mt-3 border-t border-steel-800 pt-3">
          <button
            type="button"
            onClick={onToggleExpand}
            className="label-cap flex items-center gap-1.5 text-steel-400 hover:text-steel-200 focus-visible:outline-2 focus-visible:outline-signal-cyan"
            aria-expanded={expanded}
          >
            <span aria-hidden>{expanded ? "▾" : "▸"}</span> notes
          </button>
          {expanded && (
            <p className="mono-data mt-2 max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-steel-300">
              {record.notes}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
