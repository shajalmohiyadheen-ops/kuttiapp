"use client";

import type { Project } from "@expresscash/shared";
import { useApp } from "@/lib/app-context";
import { RequireRole } from "@/components/shell";
import { CrudPage } from "@/components/crud";

export default function ProjectsPage() {
  const { t } = useApp();
  return (
    <RequireRole roles={["admin"]}>
      <p className="muted">The project list staff pick from on their phone. Untick Active when a project ends; it stays in past records.</p>
      <CrudPage<Project>
        title={t("projects")}
        table="projects"
        order="name"
        defaults={{ active: true }}
        fields={[
          { key: "name", label: t("name"), required: true, placeholder: "e.g. ABB substation" },
          { key: "code", label: `${t("code")} (optional)` },
          { key: "active", label: t("active"), type: "checkbox" },
        ]}
        columns={[
          { label: t("name"), render: (p) => p.name },
          { label: t("code"), render: (p) => <span className="muted">{p.code ?? ""}</span> },
        ]}
      />
    </RequireRole>
  );
}
