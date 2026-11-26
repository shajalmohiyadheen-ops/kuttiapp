"use client";

import { useState } from "react";
import type { Expense } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must } from "@/lib/supabase";
import { RequireRole } from "@/components/shell";
import { ExpenseDetail, ExpenseTable } from "@/components/expenses";
import { ErrorText, useLoad } from "@/components/ui";

export default function ApprovalsPage() {
  return (
    <RequireRole roles={["admin", "approver"]}>
      <Approvals />
    </RequireRole>
  );
}

function Approvals() {
  const { t, profile } = useApp();
  const [open, setOpen] = useState<Expense | null>(null);
  const list = useLoad(async () => {
    let q = supabase().from("expenses").select("*").eq("status", "pending").order("created_at");
    if (profile?.role === "approver") q = q.neq("submitted_by", profile.id);
    return must(await q) as Expense[];
  }, [profile?.id]);

  return (
    <>
      <h1>{t("approvals")}</h1>
      <p className="muted">Oldest first. Open an expense to see the invoice and approve, reject, or request changes.</p>
      <ErrorText error={list.error} />
      <ExpenseTable rows={list.data ?? []} onOpen={setOpen} />
      {open && <ExpenseDetail expense={open} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), list.reload())} />}
    </>
  );
}
