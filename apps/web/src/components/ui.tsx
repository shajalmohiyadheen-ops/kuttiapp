"use client";

import { useEffect, useState } from "react";
import { formatSar, fromDb, type ExpenseStatus, type TopupStatus } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";

/** SAR amount. direction "in" = money coming in (green, +), "out" = money going out (red, −). */
export function Money({ value, direction }: { value: number | string | null | undefined; direction?: "in" | "out" }) {
  const { locale } = useApp();
  const n = fromDb(value);
  const cls = n === 0 ? undefined : direction === "in" ? "money-in" : direction === "out" ? "money-out" : n < 0 ? "neg" : undefined;
  const sign = n !== 0 && direction === "in" ? "+" : n !== 0 && direction === "out" ? "−" : "";
  return (
    <span className={cls}>
      {sign}
      {formatSar(value, { locale })}
    </span>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof document === "undefined") return "dark";
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  });
  const set = (v: "dark" | "light") => {
    setTheme(v);
    document.documentElement.dataset.theme = v;
    try {
      localStorage.setItem("kutti.theme", v);
    } catch {}
  };
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      <button className={theme === "dark" ? "on" : undefined} onClick={() => set("dark")}>🌙</button>
      <button className={theme === "light" ? "on" : undefined} onClick={() => set("light")}>☀️</button>
    </div>
  );
}

export function StatusBadge({ status }: { status: ExpenseStatus | TopupStatus }) {
  const { t } = useApp();
  return <span className={`badge ${status}`}>{t(status)}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`field${full ? " full" : ""}`}>
      {label}
      {children}
    </label>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <div className="error" role="alert">{error}</div> : null;
}

/** Runs an async action, tracking busy and error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

/** Load data on mount and whenever deps change. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((x) => x + 1) };
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthStart(): string {
  return today().slice(0, 8) + "01";
}

export function fmtDateTime(s: string | null | undefined): string {
  return s ? new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";
}
