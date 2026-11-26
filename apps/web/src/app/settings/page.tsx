"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { RequireRole } from "@/components/shell";
import { ErrorText, Field, useAction, useLoad } from "@/components/ui";

export default function SettingsPage() {
  return (
    <RequireRole roles={["admin"]}>
      <Settings />
    </RequireRole>
  );
}

function Settings() {
  const { t } = useApp();
  const data = useLoad(async () => {
    const rows = must(await supabase().from("settings").select("*")) as Array<{ key: string; value: unknown }>;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }, []);
  const [threshold, setThreshold] = useState("");
  const [saved, setSaved] = useState(false);
  const action = useAction();
  useEffect(() => {
    if (data.data) setThreshold(String(data.data.invoice_required_above ?? 100));
  }, [data.data]);

  return (
    <>
      <h1>{t("settings")}</h1>
      <div className="panel" style={{ maxWidth: 480 }}>
        <Field label="Invoice photo required for expenses above (SAR)">
          <input inputMode="decimal" value={threshold} onChange={(e) => (setThreshold(e.target.value), setSaved(false))} />
        </Field>
        <p className="muted small">Set 0 to require an invoice for every expense. The database enforces this, so it applies to the mobile app too.</p>
        <ErrorText error={action.error || data.error} />
        <div className="actions">
          {saved && <span className="muted">Saved</span>}
          <button
            className="primary"
            disabled={action.busy}
            onClick={async () => {
              const n = Number(threshold);
              if (!Number.isFinite(n) || n < 0) return action.setError(t("invalidAmount"));
              const ok = await action.run(async () =>
                must(await supabase().from("settings").upsert({ key: "invoice_required_above", value: n, updated_at: new Date().toISOString() }).select()),
              );
              if (ok) setSaved(true);
            }}
          >
            {t("save")}
          </button>
        </div>
      </div>
    </>
  );
}
