"use client";

import { createContext, useCallback, useContext, useState } from "react";

import type { ReactNode } from "react";

type ToastKind = "info" | "success" | "error";
interface Toast { id: number; kind: ToastKind; msg: string }
interface Ctx { push: (msg: string, kind?: ToastKind) => void }

const ToastCtx = createContext<Ctx | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((msg: string, kind: ToastKind = "info") => {
    const id = ++nextId;
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`toast toast-${t.kind}`}
            onClick={() => setToasts((s) => s.filter((x) => x.id !== t.id))}
          >
            <span className="toast-dot" />
            {t.msg}
          </button>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx["push"] {
  const ctx = useContext(ToastCtx);
  // Outside the provider (SSR / test) we silently no-op so consumers don't crash.
  return ctx?.push ?? (() => undefined);
}

// Optional: a hook that intercepts a Promise and toasts on success/failure.
export function useToastedFetch() {
  const toast = useToast();
  return useCallback(async (input: RequestInfo, init?: RequestInit, opts?: { ok?: string; fail?: string }) => {
    try {
      const res = await fetch(input, init);
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        toast(opts?.fail ?? `${body.error ?? res.statusText} (${res.status})`, "error");
      } else if (opts?.ok) {
        toast(opts.ok, "success");
      }
      return res;
    } catch (error) {
      toast(opts?.fail ?? (error instanceof Error ? error.message : "Network error"), "error");
      throw error;
    }
  }, [toast]);
}

