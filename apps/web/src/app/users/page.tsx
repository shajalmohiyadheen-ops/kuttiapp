"use client";

import { useState } from "react";
import type { Profile, UserRole } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { RequireRole } from "@/components/shell";
import { ErrorText, Field, Modal, useAction, useLoad } from "@/components/ui";

const ROLES: UserRole[] = ["custodian", "accounts", "admin"];

export default function UsersPage() {
  return (
    <RequireRole roles={["admin"]}>
      <Users />
    </RequireRole>
  );
}

function Users() {
  const { t, profile: me, reloadLookups } = useApp();
  const list = useLoad(async () => must(await supabase().from("profiles").select("*").order("full_name")) as Profile[], []);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [adding, setAdding] = useState(false);
  const action = useAction();
  const roleLabel = (r: UserRole) => t(r);
  const [resetting, setResetting] = useState<Profile | null>(null);

  return (
    <>
      <h1>{t("users")}</h1>
      <div className="toolbar">
        <p className="muted grow">
          Add anyone with any email address (Gmail or company mail). <strong>Field Staff</strong> carry a card and record spending on their phone; they only see their own
          wallet. <strong>Accounts</strong> review everything on the central dashboard, download bills and tick entries as checked. <strong>Super Admin</strong> sets up
          users, wallets, projects and transfers, and closes months.
        </p>
        <button className="primary" onClick={() => setAdding(true)}>{t("inviteUser")}</button>
      </div>
      <ErrorText error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("name")}</th>
              <th>{t("email")}</th>
              <th>{t("role")}</th>
              <th>{t("active")}</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((p) => (
              <tr key={p.id} className="clickable" onClick={() => (action.setError(null), setEditing({ ...p }))}>
                <td>{p.full_name || "—"}</td>
                <td>{p.email}</td>
                <td>{roleLabel(p.role)}</td>
                <td>{p.active ? "Yes" : <span className="muted">No</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing.email ?? ""} onClose={() => setEditing(null)}>
          <div className="form">
            <Field label={t("name")}>
              <input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </Field>
            <Field label={t("role")}>
              <select value={editing.role} disabled={editing.id === me?.id} onChange={(e) => setEditing({ ...editing, role: e.target.value as UserRole })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{roleLabel(r)}</option>
                ))}
              </select>
            </Field>
            <label className="field">
              {t("active")}
              <input type="checkbox" checked={editing.active} disabled={editing.id === me?.id} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
            </label>
          </div>
          {editing.id === me?.id && <p className="muted small">You can&apos;t change your own role or deactivate yourself.</p>}
          <p className="small">
            <a href="#" onClick={(e) => (e.preventDefault(), setResetting(editing), setEditing(null))}>{t("resetPassword")}</a>
          </p>
          <ErrorText error={action.error} />
          <div className="actions">
            <button onClick={() => setEditing(null)}>{t("cancel")}</button>
            <button
              className="primary"
              disabled={action.busy}
              onClick={async () => {
                const ok = await action.run(async () =>
                  must(
                    await supabase()
                      .from("profiles")
                      .update({ full_name: editing.full_name, phone: editing.phone || null, role: editing.role, active: editing.active })
                      .eq("id", editing.id)
                      .select(),
                  ),
                );
                if (ok) {
                  setEditing(null);
                  list.reload();
                  reloadLookups();
                }
              }}
            >
              {t("save")}
            </button>
          </div>
        </Modal>
      )}
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
      {adding && <AddUser onClose={() => setAdding(false)} onSaved={() => (setAdding(false), list.reload(), reloadLookups())} />}
    </>
  );
}

function AddUser({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t, session } = useApp();
  const [f, setF] = useState({ full_name: "", email: "", role: "custodian" as UserRole, password: suggestPassword() });
  const action = useAction();
  return (
    <Modal title={t("inviteUser")} onClose={onClose}>
      <div className="form">
        <Field label={t("name")}>
          <input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        </Field>
        <Field label={t("email")}>
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label={t("role")}>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as UserRole })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(r)}</option>
            ))}
          </select>
        </Field>
        <Field label="Temporary password">
          <input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
      </div>
      <p className="muted small">Share the email and password with the person directly (in person or on WhatsApp). For staff, also send the install link from <a href="/invite">Invite staff</a>.</p>
      <ErrorText error={action.error} />
      <div className="actions">
        <button onClick={onClose}>{t("cancel")}</button>
        <button
          className="primary"
          disabled={action.busy}
          onClick={async () => {
            const ok = await action.run(async () => {
              const res = await fetch("/api/users", {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token}` },
                body: JSON.stringify(f),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json.error || "Failed");
              return true;
            });
            if (ok) onSaved();
          }}
        >
          {t("save")}
        </button>
      </div>
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: Profile; onClose: () => void }) {
  const { t, session } = useApp();
  const [password, setPassword] = useState(suggestPassword());
  const [done, setDone] = useState(false);
  const action = useAction();
  return (
    <Modal title={`${t("resetPassword")}: ${user.full_name || user.email}`} onClose={onClose}>
      {done ? (
        <p>
          Done. The new password is <strong className="mono">{password}</strong>. Send it to {user.full_name || user.email}.
        </p>
      ) : (
        <Field label="New password">
          <input value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      )}
      <ErrorText error={action.error} />
      <div className="actions">
        <button onClick={onClose}>{done ? "Close" : t("cancel")}</button>
        {!done && (
          <button
            className="primary"
            disabled={action.busy}
            onClick={async () => {
              const ok = await action.run(async () => {
                const res = await fetch("/api/users", {
                  method: "PATCH",
                  headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token}` },
                  body: JSON.stringify({ id: user.id, password }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || "Failed");
                return true;
              });
              if (ok) setDone(true);
            }}
          >
            {t("resetPassword")}
          </button>
        )}
      </div>
    </Modal>
  );
}

function suggestPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined") crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
