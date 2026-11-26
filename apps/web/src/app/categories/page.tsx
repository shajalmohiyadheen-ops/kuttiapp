"use client";

import type { Category } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { RequireRole } from "@/components/shell";
import { CrudPage } from "@/components/crud";

export default function CategoriesPage() {
  const { t } = useApp();
  return (
    <RequireRole roles={["admin"]}>
      <CrudPage<Category & { odoo_account_code: string | null }>
        title={t("categories")}
        table="categories"
        order="name"
        defaults={{ active: true }}
        fields={[
          { key: "name", label: t("name"), required: true },
          { key: "name_ar", label: `${t("name")} (عربي)` },
          { key: "odoo_account_code", label: "Odoo account code (Phase 2)" },
          { key: "active", label: t("active"), type: "checkbox" },
        ]}
        columns={[
          { label: t("name"), render: (c) => c.name },
          { label: "عربي", render: (c) => c.name_ar ?? "" },
          { label: "Odoo", render: (c) => <span className="muted">{c.odoo_account_code ?? ""}</span> },
        ]}
      />
    </RequireRole>
  );
}
