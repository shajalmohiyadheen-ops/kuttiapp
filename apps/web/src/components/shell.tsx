"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import { supabase } from "@/lib/supabase";
import type { MessageKey, UserRole } from "@kuttiapp/shared";
import { ErrorText, Field, ThemeToggle, Wordmark } from "./ui";

const NAV: Array<{ href: string; key: MessageKey; roles: UserRole[] }> = [
  { href: "/", key: "dashboard", roles: ["admin", "accounts"] },
  { href: "/expenses", key: "expenses", roles: ["admin", "accounts"] },
  { href: "/topups", key: "topups", roles: ["admin", "accounts"] },
  { href: "/close", key: "closeMonth", roles: ["admin", "accounts"] },
  { href: "/reconciliation", key: "reconciliation", roles: ["admin"] },
  { href: "/wallets", key: "wallets", roles: ["admin"] },
  { href: "/projects", key: "projects", roles: ["admin"] },
  { href: "/categories", key: "categories", roles: ["admin"] },
  { href: "/users", key: "users", roles: ["admin"] },
  { href: "/invite", key: "invite", roles: ["admin"] },
  { href: "/settings", key: "settings", roles: ["admin"] },
  { href: "/audit", key: "auditLog", roles: ["admin", "accounts"] },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { ready, session, profile, t } = useApp();
  const path = usePathname();
  const router = useRouter();
  const isPhoneApp = path.startsWith("/app");

  // Staff always use the phone screens; admins and accounts can open them too.
  useEffect(() => {
    if (profile?.role === "custodian" && !isPhoneApp) router.replace("/app");
  }, [profile, isPhoneApp, router]);

  if (!ready) return null;
  if (!session) return <Login />;
  if (!profile) return <div className="main muted">…</div>;
  if (!profile.active) {
    return (
      <div className="login panel">
        <p>This account is switched off. Ask your admin to switch it back on.</p>
        <button onClick={() => supabase().auth.signOut()}>{t("signOut")}</button>
      </div>
    );
  }
  if (isPhoneApp) return <>{children}</>;
  if (profile.role === "custodian") return null;

  const items = NAV.filter((n) => n.roles.includes(profile.role));
  return (
    <div className="layout">
      <nav className="nav">
        <div className="brand">
          <Wordmark />
        </div>
        {items.map((n) => (
          <Link key={n.href} href={n.href} className={(n.href === "/" ? path === "/" : path.startsWith(n.href)) ? "active" : undefined}>
            {t(n.key)}
          </Link>
        ))}
        <Link href="/app">📱 Phone view</Link>
        <div className="spacer" />
        <ThemeToggle />
        <div className="who">
          {profile.full_name || profile.email}
          <br />
          {t(profile.role)}
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
  const { t } = useApp();
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
        const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
        setBusy(false);
        if (error) setError(error.message === "Invalid login credentials" ? "Wrong email or password. Ask your admin to reset it if you forgot." : error.message);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="train-hero" src="/train.webp" alt="Express Cash" />
      <div style={{ display: "grid", gap: 14 }}>
        <Field label={t("email")}>
          <input type="email" inputMode="email" autoCapitalize="none" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label={t("password")}>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorText error={error} />
        <button className="primary big" disabled={busy}>{t("signIn")}</button>
        <ThemeToggle />
      </div>
    </form>
  );
}

/** Wrap role-only page content. RLS enforces this anyway; this just avoids empty screens. */
export function RequireRole({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const { profile } = useApp();
  if (!profile || !roles.includes(profile.role)) return <p className="muted">You don&apos;t have access to this page.</p>;
  return <>{children}</>;
}
