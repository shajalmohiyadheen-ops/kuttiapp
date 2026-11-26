"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/lib/app-context";
import { supabase } from "@/lib/supabase";
import type { MessageKey, UserRole } from "@kuttiapp/shared";
import { ErrorText, Field, ThemeToggle } from "./ui";

const NAV: Array<{ href: string; key: MessageKey; roles: UserRole[] }> = [
  { href: "/", key: "dashboard", roles: ["admin", "approver"] },
  { href: "/approvals", key: "approvals", roles: ["admin", "approver"] },
  { href: "/expenses", key: "expenses", roles: ["admin", "approver", "custodian"] },
  { href: "/topups", key: "topups", roles: ["admin"] },
  { href: "/reconciliation", key: "reconciliation", roles: ["admin"] },
  { href: "/wallets", key: "wallets", roles: ["admin"] },
  { href: "/projects", key: "projects", roles: ["admin"] },
  { href: "/categories", key: "categories", roles: ["admin"] },
  { href: "/users", key: "users", roles: ["admin"] },
  { href: "/settings", key: "settings", roles: ["admin"] },
  { href: "/audit", key: "auditLog", roles: ["admin"] },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { ready, session, profile, t, locale, setLocale } = useApp();
  const path = usePathname();

  if (!ready) return null;
  if (!session) return <Login />;
  if (!profile) return <div className="main muted">…</div>;
  if (!profile.active) {
    return (
      <div className="login panel">
        <p>This account is disabled. Ask a finance admin to re-activate it.</p>
        <button onClick={() => supabase().auth.signOut()}>{t("signOut")}</button>
      </div>
    );
  }

  const items = NAV.filter((n) => n.roles.includes(profile.role));
  return (
    <div className="layout">
      <nav className="nav">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="KuttiApp" />
        </div>
        {items.map((n) => (
          <Link key={n.href} href={n.href} className={(n.href === "/" ? path === "/" : path.startsWith(n.href)) ? "active" : undefined}>
            {t(n.key)}
          </Link>
        ))}
        <div className="spacer" />
        <ThemeToggle />
        <a href="#" onClick={(e) => (e.preventDefault(), setLocale(locale === "en" ? "ar" : "en"))}>
          {t("language")}
        </a>
        <div className="who">
          {profile.full_name || profile.email}
          <br />
          {t(profile.role === "admin" ? "admin" : profile.role)}
        </div>
        <a href="#" onClick={(e) => (e.preventDefault(), supabase().auth.signOut())}>
          {t("signOut")}
        </a>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}

function Login() {
  const { t, locale, setLocale } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="login panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const { error } = await supabase().auth.signInWithPassword({ email, password });
        setBusy(false);
        if (error) setError(error.message);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo" src="/logo.png" alt="KuttiApp" />
      <div style={{ display: "grid", gap: 12 }}>
        <Field label={t("email")}>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label={t("password")}>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorText error={error} />
        <button className="primary" disabled={busy}>{t("signIn")}</button>
        <button type="button" onClick={() => setLocale(locale === "en" ? "ar" : "en")}>{t("language")}</button>
      </div>
    </form>
  );
}

/** Wrap admin-only page content. RLS enforces this anyway; this just avoids empty screens. */
export function RequireRole({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const { profile } = useApp();
  if (!profile || !roles.includes(profile.role)) return <p className="muted">You don&apos;t have access to this page.</p>;
  return <>{children}</>;
}
