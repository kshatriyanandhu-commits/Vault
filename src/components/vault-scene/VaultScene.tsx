"use client";

import { useEffect, useRef } from "react";
import { VaultEngine, type VaultPhase } from "./vault-engine";

type Props = {
  phase: VaultPhase;
  /** Increment once per typed character to spin the combination dial. */
  dialTick?: number;
  className?: string;
  /** Compact HUD label shown in the corner of the scene. */
  showStatus?: boolean;
};

const PHASE_LABEL: Record<VaultPhase, string> = {
  sealed: "SEALED",
  typing: "DIALING",
  unlocking: "UNLOCKING",
  open: "OPEN",
  error: "REJECTED",
  locked: "LOCKED",
};

const PHASE_LED: Record<VaultPhase, string> = {
  sealed: "led-amber",
  typing: "led-amber",
  unlocking: "led-green",
  open: "led-green",
  error: "led-red",
  locked: "led-amber",
};

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

/**
 * Interactive vault scene. The canvas is decorative (role="img" with a text
 * label); every real control lives in the DOM, so the app remains fully
 * keyboard- and mobile-usable without WebGL.
 *
 * WebGL support is handled by mutating DOM nodes directly inside the effect
 * (no React state): the "initializing" placeholder hides once the engine is
 * up, and the CSS fallback becomes visible if WebGL is unavailable.
 */
export function VaultScene({
  phase,
  dialTick = 0,
  className = "",
  showStatus = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fallbackRef = useRef<HTMLDivElement | null>(null);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<VaultEngine | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const placeholder = placeholderRef.current;
    const fallback = fallbackRef.current;

    let engine: VaultEngine | null = null;
    if (detectWebGL()) {
      try {
        engine = new VaultEngine(el);
      } catch (err) {
        console.warn("[argus] 3D scene unavailable, using fallback:", err);
      }
    }

    if (placeholder) placeholder.style.display = "none";
    if (!engine && fallback) fallback.style.display = "grid";

    if (engine) {
      engineRef.current = engine;
      return () => {
        engine?.dispose();
        engineRef.current = null;
      };
    }
    return undefined;
  }, []);

  useEffect(() => {
    engineRef.current?.setPhase(phase);
  }, [phase]);

  useEffect(() => {
    if (dialTick === 0) return;
    engineRef.current?.nudgeDial(dialTick % 2 === 0 ? 1 : -1);
  }, [dialTick]);

  return (
    <div
      className={`relative overflow-hidden rounded-sm bg-steel-950 ${className}`}
      role="img"
      aria-label={`Animated 3D steel vault door — status: ${PHASE_LABEL[phase].toLowerCase()}`}
    >
      <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />

      {/* Shown until the engine reports success (or failure) in the effect. */}
      <div
        ref={placeholderRef}
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center"
      >
        <span className="label-cap animate-led-pulse text-steel-500">
          initializing vault…
        </span>
      </div>

      {/* CSS-only fallback, revealed when WebGL is unavailable. */}
      <div
        ref={fallbackRef}
        aria-hidden="true"
        className="absolute inset-0"
        style={{ display: "none" }}
      >
        <VaultFallback phase={phase} dialTick={dialTick} />
      </div>

      {showStatus && (
        <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-sm border border-steel-750 bg-steel-950/70 px-2.5 py-1.5 backdrop-blur-sm">
          <span className={`led ${PHASE_LED[phase]}`} />
          <span className="label-cap text-steel-300">
            vault&nbsp;·&nbsp;{PHASE_LABEL[phase]}
          </span>
        </div>
      )}
    </div>
  );
}

/** CSS-only vault used when WebGL is unavailable. Reacts to the same phases. */
function VaultFallback({
  phase,
  dialTick,
}: {
  phase: VaultPhase;
  dialTick: number;
}) {
  const open = phase === "open" || phase === "unlocking";
  return (
    <div className="absolute inset-0 grid place-items-center [perspective:900px]">
      <div className="relative aspect-square w-[min(72vw,340px)]">
        <div
          className={`fallback-door absolute inset-0 ${phase === "error" ? "animate-shake" : ""}`}
          style={{
            transform: open ? "rotateY(-72deg) translateX(-26%)" : "none",
            boxShadow: open
              ? "inset 0 0 0 14px #171d25, 0 0 60px -6px rgba(56,219,232,0.45)"
              : undefined,
          }}
        >
          <div
            className="fallback-dial absolute top-1/2 left-1/2 h-[34%] w-[34%]"
            style={{
              transform: `translate(-50%, -50%) rotate(${dialTick * 41}deg)`,
            }}
          >
            <div className="absolute inset-[42%] rounded-full bg-steel-700" />
          </div>
          <div className="absolute bottom-[14%] left-1/2 flex -translate-x-1/2 gap-2">
            <span className={`led ${phase === "error" ? "led-red" : "led-off"}`} />
            <span
              className={`led ${
                open
                  ? "led-off"
                  : phase === "typing"
                    ? "led-amber animate-led-pulse"
                    : "led-amber"
              }`}
            />
            <span className={`led ${open ? "led-green" : "led-off"}`} />
          </div>
        </div>
        <div className="absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-steel-750 bg-steel-950/80 px-2 py-1">
          <span className="label-cap text-steel-500">compatibility mode</span>
        </div>
      </div>
    </div>
  );
}
