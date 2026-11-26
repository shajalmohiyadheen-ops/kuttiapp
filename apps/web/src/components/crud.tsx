"use client";

import { useState } from "react";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { ErrorText, Field, Modal, useAction, useLoad } from "./ui";

export interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "number" | "checkbox" | "select";
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  /** Only editable when creating */
  createOnly?: boolean;
  placeholder?: string;
}

export interface ColumnDef<T> {
  label: string;
  render: (row: T) => React.ReactNode;
  num?: boolean;
}

/** List + create/edit modal for a simple master-data table. Rows are never deleted: deactivate them instead. */
export function CrudPage<T extends { id: string; active?: boolean }>({
  title,
  table,
  order,
  fields,
  columns,
  defaults,
}: {
  title: string;
  table: string;
  order: string;
  fields: FieldDef[];
  columns: ColumnDef<T>[];
  defaults: Record<string, unknown>;
}) {
  const { t, reloadLookups } = useApp();
  const list = useLoad(async () => must(await supabase().from(table).select("*").order(order)) as T[], [table]);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const action = useAction();

  async function save() {
    if (!editing) return;
    for (const f of fields) {
      if (f.required && (editing[f.key] === "" || editing[f.key] === null || editing[f.key] === undefined)) {
        action.setError(`${f.label}: ${t("required")}`);
        return;
      }
    }
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      if (editing.id && f.createOnly) continue;
      let v = editing[f.key];
      if (v === "") v = null;
      if (f.type === "number" && v !== null && v !== undefined) v = Number(v);
      payload[f.key] = v;
    }
    const ok = await action.run(async () => {
      const sb = supabase();
      if (editing.id) must(await sb.from(table).update(payload).eq("id", editing.id as string).select());
      else must(await sb.from(table).insert(payload).select());
      return true;
    });
    if (ok) {
      setEditing(null);
      list.reload();
      reloadLookups();
    }
  }

  return (
    <>
      <h1>{title}</h1>
      <div className="toolbar">
        <div className="grow" />
        <button className="primary" onClick={() => (action.setError(null), setEditing({ ...defaults }))}>{t("add")}</button>
      </div>
      <ErrorText error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.label} className={c.num ? "num" : undefined}>{c.label}</th>
              ))}
              <th>{t("active")}</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((row) => (
              <tr key={row.id} className="clickable" onClick={() => (action.setError(null), setEditing({ ...row }))}>
                {columns.map((c) => (
                  <td key={c.label} className={c.num ? "num" : undefined}>{c.render(row)}</td>
                ))}
                <td>{row.active === false ? <span className="muted">No</span> : "Yes"}</td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="muted">{t("noData")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={`${editing.id ? t("edit") : t("add")}: ${title}`} onClose={() => setEditing(null)}>
          <div className="form">
            {fields.map((f) => {
              const disabled = Boolean(editing.id && f.createOnly);
              const value = editing[f.key];
              const onChange = (v: unknown) => setEditing({ ...editing, [f.key]: v });
              if (f.type === "checkbox") {
                return (
                  <label key={f.key} className="field">
                    {f.label}
                    <input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
                  </label>
                );
              }
              return (
                <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                  {f.type === "select" ? (
                    <select value={(value as string) ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
                      {!f.required && <option value="" />}
                      {f.required && !value && <option value="" />}
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={(value as string | number | null) ?? ""}
                      disabled={disabled}
                      placeholder={f.placeholder}
                      inputMode={f.type === "number" ? "decimal" : undefined}
                      onChange={(e) => onChange(e.target.value)}
                    />
                  )}
                </Field>
              );
            })}
          </div>
          <ErrorText error={action.error} />
          <div className="actions">
            <button onClick={() => setEditing(null)}>{t("cancel")}</button>
            <button className="primary" disabled={action.busy} onClick={save}>{t("save")}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
