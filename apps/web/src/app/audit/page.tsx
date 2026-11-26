"use client";

import { useState } from "react";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { RequireRole } from "@/components/shell";
import { ErrorText, Field, Modal, fmtDateTime, useLoad } from "@/components/ui";

interface AuditRow {
  id: number;
  table_name: string;
  record_id: string;
  action: string;
  actor_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  at: string;
}

export default function AuditPage() {
  return (
    <RequireRole roles={["admin"]}>
      <Audit />
    </RequireRole>
  );
}

function changed(row: AuditRow): string[] {
  if (!row.old_data || !row.new_data) return [];
  return Object.keys(row.new_data).filter((k) => k !== "updated_at" && JSON.stringify(row.old_data![k]) !== JSON.stringify(row.new_data![k]));
}

function Audit() {
  const { t, name } = useApp();
  const [table, setTable] = useState("");
  const [open, setOpen] = useState<AuditRow | null>(null);
  const list = useLoad(async () => {
    let q = supabase().from("audit_log").select("*").order("at", { ascending: false }).limit(300);
    if (table) q = q.eq("table_name", table);
    return must(await q) as AuditRow[];
  }, [table]);

  return (
    <>
      <h1>{t("auditLog")}</h1>
      <div className="toolbar">
        <Field label="Table">
          <select value={table} onChange={(e) => setTable(e.target.value)}>
            <option value="">{t("all")}</option>
            {["expenses", "topups", "wallets", "projects", "categories", "profiles", "settings", "statement_checks"].map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorText error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Table</th>
              <th>Action</th>
              <th>Record</th>
              <th>Changed</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                <td className="small">{fmtDateTime(r.at)}</td>
                <td>{r.actor_id ? name("profiles", r.actor_id) : <span className="muted">system</span>}</td>
                <td>{r.table_name}</td>
                <td>{r.action}</td>
                <td className="small muted">{String((r.new_data ?? r.old_data)?.external_id ?? r.record_id)}</td>
                <td className="small">{changed(r).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal title={`${open.table_name} ${open.action}`} onClose={() => setOpen(null)}>
          <pre className="small" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
            {JSON.stringify({ before: open.old_data, after: open.new_data }, null, 2)}
          </pre>
        </Modal>
      )}
    </>
  );
}
