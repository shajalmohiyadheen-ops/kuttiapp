"use client";

import type { Wallet } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { RequireRole } from "@/components/shell";
import { CrudPage } from "@/components/crud";

export default function WalletsPage() {
  const { t, lookups, name } = useApp();
  const people = lookups.profiles.filter((p) => p.active).map((p) => ({ value: p.id, label: p.full_name || p.email || p.id }));
  return (
    <RequireRole roles={["admin"]}>
      <p className="muted">A wallet is one Alinma card or one cash float, held by one custodian. Its balance is calculated from top-ups and expenses.</p>
      <CrudPage<Wallet>
        title={t("wallets")}
        table="wallets"
        order="name"
        defaults={{ kind: "card", bank_name: "Alinma", active: true }}
        fields={[
          { key: "name", label: t("name"), required: true, placeholder: "e.g. Ahmed - Alinma card" },
          { key: "kind", label: "Type", type: "select", required: true, createOnly: true, options: [{ value: "card", label: t("card") }, { value: "cash", label: t("cash") }] },
          { key: "custodian_id", label: t("custodian"), type: "select", required: true, options: people },
          { key: "bank_name", label: t("bank") },
          { key: "card_last4", label: t("cardLast4"), placeholder: "1234" },
          { key: "active", label: t("active"), type: "checkbox" },
        ]}
        columns={[
          { label: t("name"), render: (w) => w.name },
          { label: "ID", render: (w) => <span className="small muted">{w.external_id}</span> },
          { label: "Type", render: (w) => (w.kind === "card" ? `${t("card")} •••• ${w.card_last4 ?? ""}` : t("cash")) },
          { label: t("custodian"), render: (w) => name("profiles", w.custodian_id) },
        ]}
      />
    </RequireRole>
  );
}
