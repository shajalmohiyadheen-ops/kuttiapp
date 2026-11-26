"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { RequireRole } from "@/components/shell";
import { ErrorText, Field, useAction } from "@/components/ui";

export default function SettingsPage() {
  return (
    <RequireRole roles={["admin"]}>
      <Settings />
    </RequireRole>
  );
}

const ITEMS = [
  { key: "invoice_required_above", label: "Bill photo required for expenses above (SAR)", help: "Set 0 to require a photo for every expense (except no-bill categories).", fallback: 100, min: 0, max: 1000000 },
  { key: "retention_months", label: "Months kept open (including this month)", help: "Staff can enter expenses for this many months. Older months must be closed (exported and erased).", fallback: 5, min: 1, max: 12 },
  { key: "storage_limit_mb", label: "Invoice storage on your Supabase plan (MB)", help: "The dashboard warns at 80%. Free plan: 1000 MB.", fallback: 1000, min: 100, max: 1000000 },
];

function Settings() {
  const { t, lookups, reloadLookups } = useApp();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const action = useAction();
  useEffect(() => {
    setValues(Object.fromEntries(ITEMS.map((i) => [i.key, String(lookups.settings[i.key] ?? i.fallback)])));
  }, [lookups.settings]);

  async function save() {
    for (const i of ITEMS) {
      const n = Number(values[i.key]);
      if (!Number.isFinite(n) || n < i.min || n > i.max) return action.setError(`${i.label}: enter a number from ${i.min} to ${i.max}`);
    }
    const ok = await action.run(async () =>
      must(
        await supabase()
          .from("settings")
          .upsert(ITEMS.map((i) => ({ key: i.key, value: Number(values[i.key]), updated_at: new Date().toISOString() })))
          .select(),
      ),
    );
    if (ok) {
      setSaved(true);
      reloadLookups();
    }
  }

  return (
    <>
      <h1>{t("settings")}</h1>
      <div className="panel" style={{ maxWidth: 520 }}>
        {ITEMS.map((i) => (
          <div key={i.key} style={{ marginBottom: 14 }}>
            <Field label={i.label}>
              <input inputMode="numeric" value={values[i.key] ?? ""} onChange={(e) => (setValues({ ...values, [i.key]: e.target.value }), setSaved(false))} />
            </Field>
            <p className="muted small">{i.help}</p>
          </div>
        ))}
        <p className="muted small">The database enforces these, so they apply to the phone app too.</p>
        <ErrorText error={action.error} />
        <div className="actions">
          {saved && <span className="muted">Saved</span>}
          <button className="primary" disabled={action.busy} onClick={save}>{t("save")}</button>
        </div>
      </div>
    </>
  );
}
