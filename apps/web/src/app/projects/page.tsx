"use client";

import type { Project } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { RequireRole } from "@/components/shell";
import { CrudPage } from "@/components/crud";
import { Money } from "@/components/ui";

export default function ProjectsPage() {
  const { t, lookups, name } = useApp();
  const approvers = lookups.profiles
    .filter((p) => p.active && (p.role === "approver" || p.role === "admin"))
    .map((p) => ({ value: p.id, label: p.full_name || p.email || p.id }));
  return (
    <RequireRole roles={["admin"]}>
      <CrudPage<Project>
        title={t("projects")}
        table="projects"
        order="code"
        defaults={{ active: true }}
        fields={[
          { key: "code", label: t("code"), required: true, placeholder: "P-001" },
          { key: "name", label: t("name"), required: true },
          { key: "name_ar", label: `${t("name")} (عربي)` },
          { key: "approver_id", label: t("approver"), type: "select", options: approvers },
          { key: "budget", label: `${t("budget")} (SAR)`, type: "number" },
          { key: "active", label: t("active"), type: "checkbox" },
        ]}
        columns={[
          { label: t("code"), render: (p) => p.code },
          { label: t("name"), render: (p) => p.name + (p.name_ar ? ` · ${p.name_ar}` : "") },
          { label: t("approver"), render: (p) => (p.approver_id ? name("profiles", p.approver_id) : <span className="muted">Finance admin</span>) },
          { label: t("budget"), num: true, render: (p) => (p.budget === null ? "—" : <Money value={p.budget} />) },
        ]}
      />
    </RequireRole>
  );
}
