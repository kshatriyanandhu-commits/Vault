"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast-context";
import { apiFetch, ApiRequestError, postJson } from "@/lib/api";
import type {
  AdminStatsDto,
  AuditEventDto,
  SessionDto,
  SessionStatusFilterValue,
} from "@/lib/types";

type LoadState = "loading" | "ready" | "error";

const POLL_MS = 10_000;

const STATUS_STYLE: Record<SessionDto["status"], string> = {
  active: "border-signal-green-dim text-signal-green",
  signed_out: "border-steel-600 text-steel-400",
  revoked: "border-signal-red-dim text-signal-red",
};

const EVENT_STYLE: Record<string, string> = {
  signin_success: "led-green",
  signin_failure: "led-red",
  signout: "led-off",
  signup: "led-cyan",
  session_revoke: "led-red",
};

function fmt(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return `${hash.slice(0, 10)}…`;
}

type DashboardData = {
  stats: AdminStatsDto;
  sessions: SessionDto[];
  events: AuditEventDto[];
};

/** Pure fetch — no React state involved; callers apply the result. */
async function fetchDashboard(
  search: string,
  status: SessionStatusFilterValue,
): Promise<DashboardData> {
  const params = new URLSearchParams({
    search,
    status,
    limit: "60",
  });
  const [statsRes, sessionsRes, auditRes] = await Promise.all([
    apiFetch<AdminStatsDto>("/api/admin/stats"),
    apiFetch<{ sessions: SessionDto[] }>(`/api/admin/sessions?${params}`),
    apiFetch<{ events: AuditEventDto[] }>("/api/admin/audit?limit=30"),
  ]);
  return {
    stats: statsRes,
    sessions: sessionsRes.sessions,
    events: auditRes.events,
  };
}

export function ConsoleView() {
  const toast = useToast();
  const [stats, setStats] = useState<AdminStatsDto | null>(null);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [events, setEvents] = useState<AuditEventDto[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<SessionStatusFilterValue>("all");
  const [live, setLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<SessionDto | null>(null);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  // Debounce search input
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const applyDashboard = useCallback((data: DashboardData) => {
    setStats(data.stats);
    setSessions(data.sessions);
    setEvents(data.events);
    setLastUpdated(new Date());
    setLoadState("ready");
    setLoadError(null);
  }, []);

  const applyLoadError = useCallback((err: unknown) => {
    setLoadError(
      err instanceof ApiRequestError ? err.message : "Could not load audit data.",
    );
    setLoadState("error");
  }, []);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      try {
        const data = await fetchDashboard(debouncedSearch, status);
        applyDashboard(data);
      } catch (err) {
        if (!opts?.silent) applyLoadError(err);
      }
    },
    [debouncedSearch, status, applyDashboard, applyLoadError],
  );

  // Initial load + reload on filter changes (state is applied in the promise
  // callback rather than synchronously inside the effect body).
  useEffect(() => {
    let cancelled = false;
    fetchDashboard(debouncedSearch, status).then(
      (data) => {
        if (!cancelled) applyDashboard(data);
      },
      (err) => {
        if (!cancelled) applyLoadError(err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, status, applyDashboard, applyLoadError]);

  // Live polling
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      if (liveRef.current) void load({ silent: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [live, load]);

  async function handleRevoke(session: SessionDto) {
    setRevokingId(session.id);
    try {
      await postJson(`/api/admin/sessions/${session.id}/revoke`);
      toast.push(`Session revoked for ${session.user.email}`, "success");
      setConfirmRevoke(null);
      await load({ silent: true });
    } catch (err) {
      toast.push(
        err instanceof ApiRequestError ? err.message : "Could not revoke session.",
        "error",
      );
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Title row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold tracking-wide text-steel-100">
            Session audit console
          </h1>
          <p className="mt-1 text-xs text-steel-400">
            Live session telemetry across all accounts. Credential contents are
            never exposed here — the server cannot read them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="mono-data text-[0.65rem] text-steel-500">
              updated {lastUpdated.toLocaleTimeString(undefined, { hour12: false })}
            </span>
          )}
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className={`btn ${live ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={live}
          >
            <span className={`led ${live ? "led-green animate-led-pulse" : "led-off"}`} aria-hidden />
            Live {live ? "on" : "off"}
          </button>
          <button type="button" onClick={() => void load()} className="btn btn-ghost">
            Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      {stats ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="accounts" value={stats.totalUsers} />
          <StatCard
            label="active sessions"
            value={stats.sessions.active}
            tone="text-signal-green"
          />
          <StatCard label="signed out" value={stats.sessions.signed_out} />
          <StatCard
            label="revoked"
            value={stats.sessions.revoked}
            tone="text-signal-red"
          />
          <StatCard
            label="sign-ins · 24h"
            value={stats.events24h.signin_success}
            tone="text-signal-cyan"
          />
          <StatCard
            label="failed · 24h"
            value={stats.events24h.signin_failure}
            tone={stats.events24h.signin_failure > 0 ? "text-signal-amber" : undefined}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="panel h-[76px] animate-pulse rounded-sm" />
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="panel flex flex-wrap items-center gap-3 rounded-sm p-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="console-search" className="sr-only">
            Search sessions
          </label>
          <input
            id="console-search"
            type="search"
            className="field-input"
            placeholder="Search email, name, device, user-agent…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="console-status" className="sr-only">
            Filter by status
          </label>
          <select
            id="console-status"
            className="field-input w-auto"
            value={status}
            onChange={(e) => setStatus(e.target.value as SessionStatusFilterValue)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="signed_out">Signed out</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>
        <p className="mono-data text-[0.65rem] text-steel-500">
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* Sessions table */}
      {loadState === "loading" && sessions.length === 0 && (
        <div className="panel h-48 animate-pulse rounded-sm" aria-busy="true" />
      )}

      {loadState === "error" && (
        <div className="panel rounded-sm border-signal-red-dim p-5">
          <div className="flex items-center gap-2">
            <span className="led led-red" aria-hidden />
            <p className="font-mono text-sm text-signal-red">Audit data unavailable</p>
          </div>
          <p className="mt-1.5 text-xs text-steel-300">{loadError}</p>
          <button type="button" className="btn btn-ghost mt-3" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {(loadState === "ready" || sessions.length > 0) && (
        <div className="panel overflow-x-auto rounded-sm">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <caption className="sr-only">Session ledger with revocation controls</caption>
            <thead>
              <tr className="border-b border-steel-800">
                {[
                  "status",
                  "account",
                  "device / fingerprint (client-reported)",
                  "user-agent",
                  "ip hash",
                  "signed in",
                  "last seen",
                  "expires",
                  "",
                ].map((h, i) => (
                  <th key={i} scope="col" className="label-cap px-3 py-2.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center">
                    <p className="font-mono text-sm text-steel-300">No sessions match</p>
                    <p className="mt-1 text-xs text-steel-500">
                      Adjust the search or status filter.
                    </p>
                  </td>
                </tr>
              )}
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-steel-800/70 transition-colors hover:bg-steel-850/60"
                >
                  <td className="px-3 py-2.5">
                    <span className={`chip ${STATUS_STYLE[s.status]}`}>
                      {s.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-mono text-xs text-steel-100">{s.user.email}</p>
                    <p className="mt-0.5 text-[0.65rem] text-steel-500">
                      {s.user.name}
                      {s.user.role === "admin" ? " · admin" : ""}
                      {s.revokedByEmail ? ` · revoked by ${s.revokedByEmail}` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-mono text-xs text-steel-200">
                      {s.deviceLabel ?? "—"}
                    </p>
                    <p
                      className="mt-0.5 max-w-[220px] truncate text-[0.62rem] text-steel-500"
                      title={s.fingerprint ?? "no fingerprint reported"}
                    >
                      {s.fingerprint ?? "no fingerprint"}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p
                      className="mono-data max-w-[220px] truncate text-[0.65rem] text-steel-300"
                      title={s.userAgent ?? undefined}
                    >
                      {s.userAgent ?? "—"}
                    </p>
                  </td>
                  <td className="mono-data px-3 py-2.5 text-[0.65rem] text-steel-400">
                    {shortHash(s.ipHash)}
                  </td>
                  <td className="mono-data px-3 py-2.5 text-[0.65rem] text-steel-300">
                    {fmt(s.signedInAt)}
                  </td>
                  <td className="mono-data px-3 py-2.5 text-[0.65rem] text-steel-300">
                    {fmt(s.lastSeenAt)}
                  </td>
                  <td className="mono-data px-3 py-2.5 text-[0.65rem] text-steel-400">
                    {fmt(s.expiresAt)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {s.status === "active" ? (
                      <button
                        type="button"
                        className="btn btn-danger px-2.5 py-1 text-[0.62rem]"
                        onClick={() => setConfirmRevoke(s)}
                      >
                        Revoke
                      </button>
                    ) : (
                      <span className="mono-data text-[0.62rem] text-steel-600">
                        {s.status === "revoked"
                          ? s.revokedAt
                            ? fmt(s.revokedAt)
                            : "revoked"
                          : s.signedOutAt
                            ? fmt(s.signedOutAt)
                            : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit feed */}
      <section aria-label="Recent audit events" className="panel rounded-sm p-4">
        <h2 className="label-cap mb-3">recent audit events</h2>
        {events.length === 0 ? (
          <p className="text-xs text-steel-500">No events recorded yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs">
                <span
                  className={`led ${EVENT_STYLE[e.event] ?? "led-off"}`}
                  aria-hidden
                />
                <span className="text-steel-200">{e.event}</span>
                {e.emailMasked && (
                  <span className="text-steel-400">{e.emailMasked}</span>
                )}
                <span className="max-w-[260px] truncate text-steel-500" title={e.userAgent ?? undefined}>
                  {e.userAgent ?? ""}
                </span>
                {e.meta && "targetSessionId" in e.meta && (
                  <span className="text-steel-500">
                    target {(e.meta as { targetSessionId: string }).targetSessionId.slice(0, 8)}…
                  </span>
                )}
                <span className="ml-auto text-steel-500">{fmt(e.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Revoke confirmation */}
      {confirmRevoke && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !revokingId) setConfirmRevoke(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm session revocation"
            className="panel animate-rise w-full max-w-sm rounded-sm p-5"
          >
            <h2 className="font-mono text-sm font-semibold text-signal-red">
              Revoke session?
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-steel-300">
              The session for{" "}
              <span className="text-steel-100">{confirmRevoke.user.email}</span>{" "}
              will be terminated immediately — that browser will be signed out
              on its next request. The user can sign in again with their master
              password.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!!revokingId}
                onClick={() => setConfirmRevoke(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!!revokingId}
                onClick={() => void handleRevoke(confirmRevoke)}
              >
                {revokingId === confirmRevoke.id ? "Revoking…" : "Revoke session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="panel rounded-sm px-4 py-3">
      <p className="label-cap">{label}</p>
      <p className={`mono-data mt-1 text-2xl font-semibold ${tone ?? "text-steel-100"}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
