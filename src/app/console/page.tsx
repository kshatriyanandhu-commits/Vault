"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { useSession } from "@/components/session-context";
import { ConsoleView } from "@/components/console/ConsoleView";

export default function ConsolePage() {
  const session = useSession();
  const router = useRouter();
  const user = session.state.status === "authenticated" ? session.state.user : null;
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (session.state.status === "anonymous") {
      router.replace("/");
    } else if (session.state.status === "authenticated" && user && !isAdmin) {
      router.replace("/vault");
    }
  }, [session.state.status, user, isAdmin, router]);

  if (session.state.status === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="label-cap animate-led-pulse text-steel-500">
          verifying session…
        </p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <div className="panel max-w-sm rounded-sm p-6 text-center">
          <span className="led led-red mx-auto mb-3 block" aria-hidden />
          <p className="font-mono text-sm text-signal-red">Administrator access required</p>
          <p className="mt-2 text-xs text-steel-400">
            Redirecting to your vault…
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <AppHeader active="console" />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <ConsoleView />
      </main>
    </div>
  );
}
