"use client";

import type { Wallet } from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { RequireRole } from "@/components/shell";
import { CrudPage } from "@/components/crud";
import { Money } from "@/components/ui";

export default function WalletsPage() {
  const { t, lookups, name } = useApp();
  const people = lookups.profiles.filter((p) => p.active).map((p) => ({ value: p.id, label: p.full_name || p.email || p.id }));
  return (
    <RequireRole roles={["admin"]}>
      <p className="muted">
        One wallet per card holder. It covers the card and any cash they withdraw from it. When someone hands their card over to a colleague,
        change the <strong>holder</strong> here: the balance and history stay with the wallet.
      </p>
      <CrudPage<Wallet>
        title={t("wallets")}
        table="wallets"
        order="name"
        defaults={{ bank_name: "Alinma", active: true }}
        fields={[
          { key: "name", label: t("name"), required: true, placeholder: "e.g. Irfan's wallet" },
          { key: "custodian_id", label: "Holder", type: "select", required: true, options: people },
          { key: "bank_name", label: t("bank"), type: "select", required: true, options: ["Alinma", "SNB", "Other"].map((b) => ({ value: b, label: b })) },
          { key: "card_last4", label: t("cardLast4"), placeholder: "1234" },
          { key: "active", label: t("active"), type: "checkbox" },
        ]}
        columns={[
          { label: t("name"), render: (w) => w.name },
          { label: "Holder", render: (w) => name("profiles", w.custodian_id) },
          { label: t("card"), render: (w) => `${w.bank_name ?? ""}${w.card_last4 ? ` •••• ${w.card_last4}` : ""}` || "—" },
          { label: "Brought forward", num: true, render: (w) => <Money value={w.opening_balance} /> },
          { label: "ID", render: (w) => <span className="small muted">{w.external_id}</span> },
        ]}
      />
    </RequireRole>
  );
}
