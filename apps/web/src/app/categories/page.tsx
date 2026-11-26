"use client";

import type { Category } from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { RequireRole } from "@/components/shell";
import { CrudPage } from "@/components/crud";

export default function CategoriesPage() {
  const { t } = useApp();
  return (
    <RequireRole roles={["admin"]}>
      <p className="muted">
        Untick <strong>{t("receiptRequired")}</strong> for spend that never has a bill, such as cash paid to outside labour. Staff can then save it without a photo, but
        must write remarks (which project, who was paid).
      </p>
      <CrudPage<Category>
        title={t("categories")}
        table="categories"
        order="name"
        defaults={{ active: true, receipt_required: true }}
        fields={[
          { key: "name", label: t("name"), required: true, placeholder: "e.g. Outside labour" },
          { key: "receipt_required", label: t("receiptRequired"), type: "checkbox" },
          { key: "active", label: t("active"), type: "checkbox" },
        ]}
        columns={[
          { label: t("name"), render: (c) => c.name },
          { label: t("receiptRequired"), render: (c) => (c.receipt_required ? "Yes" : <span className="muted">No, remarks instead</span>) },
        ]}
      />
    </RequireRole>
  );
}
