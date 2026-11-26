"use client";

import { useState } from "react";
import { parseAmount, toDecimalString, sum, type Topup, type TopupMethod } from "@kuttiapp/shared";
import { useApp } from "@/lib/app-context";
import { supabase, must, signedUrl } from "@/lib/supabase";
import { downloadXlsx } from "@/lib/export";
import { RequireRole } from "@/components/shell";
import { ErrorText, Field, Modal, Money, StatusBadge, monthStart, today, useAction, useLoad } from "@/components/ui";

const METHODS: TopupMethod[] = ["bank_transfer", "cash", "opening_balance", "custodian_repayment", "other"];

export default function TopupsPage() {
  return (
    <RequireRole roles={["admin"]}>
      <Topups />
    </RequireRole>
  );
}

function Topups() {
  const { t, lookups, name } = useApp();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [walletId, setWalletId] = useState("");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Topup | null>(null);

  const list = useLoad(async () => {
    let q = supabase().from("topups").select("*").order("transfer_date", { ascending: false }).order("created_at", { ascending: false });
    if (from) q = q.gte("transfer_date", from);
    if (to) q = q.lte("transfer_date", to);
    if (walletId) q = q.eq("wallet_id", walletId);
    return must(await q) as Topup[];
  }, [from, to, walletId]);
  const rows = list.data ?? [];

  return (
    <>
      <h1>{t("topups")}</h1>
      <p className="muted">Record every transfer into an Alinma card and every cash hand-over here. The wallet balance goes up as soon as you save.</p>
      <div className="toolbar">
        <Field label={t("from")}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("to")}>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t("wallet")}>
          <select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            <option value="">{t("all")}</option>
            {lookups.wallets.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Field>
        <div className="grow" />
        <button
          onClick={() =>
            downloadXlsx(`topups-${from}-to-${to}`, [
              {
                name: "Top-ups",
                columns: [
                  { header: "Date", key: "transfer_date", width: 12 },
                  { header: "ID", key: "external_id", width: 16 },
                  { header: "Wallet", key: "wallet", width: 24 },
                  { header: "Method", key: "method" },
                  { header: "Reference", key: "reference" },
                  { header: "Amount", key: "amount", money: true },
                  { header: "Status", key: "status" },
                  { header: "Reversal reason", key: "reversal_reason", width: 24 },
                ],
                rows: rows.map((r) => ({ ...r, wallet: name("wallets", r.wallet_id) })),
              },
            ])
          }
        >
          {t("exportExcel")}
        </button>
        <button className="primary" onClick={() => setCreating(true)}>{t("add")}</button>
      </div>
      <ErrorText error={list.error} />
      <p className="muted small">
        {t("posted")}: <Money direction="in" value={toDecimalString(sum(rows.filter((r) => r.status === "posted").map((r) => r.amount)))} />
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("date")}</th>
              <th>ID</th>
              <th>{t("wallet")}</th>
              <th>{t("method")}</th>
              <th>{t("reference")}</th>
              <th className="num">{t("amount")}</th>
              <th>{t("status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                <td style={{ whiteSpace: "nowrap" }}>{r.transfer_date}</td>
                <td className="small muted">{r.external_id}</td>
                <td>{name("wallets", r.wallet_id)}</td>
                <td>{t(r.method === "cash" ? "cash" : r.method)}</td>
                <td>{r.reference}</td>
                <td className="num"><Money value={r.amount} direction="in" /></td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="muted">{t("noData")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {creating && <NewTopup onClose={() => setCreating(false)} onSaved={() => (setCreating(false), list.reload())} />}
      {open && <TopupDetail topup={open} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), list.reload())} />}
    </>
  );
}

function NewTopup({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t, lookups, profile } = useApp();
  const wallets = lookups.wallets.filter((w) => w.active);
  const [f, setF] = useState({ wallet_id: wallets[0]?.id ?? "", amount: "", transfer_date: today(), method: "bank_transfer" as TopupMethod, reference: "", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const action = useAction();

  async function save() {
    const h = parseAmount(f.amount);
    if (h === null || h <= 0) return action.setError(t("invalidAmount"));
    if (!f.wallet_id) return action.setError(`${t("wallet")}: ${t("required")}`);
    const ok = await action.run(async () => {
      const sb = supabase();
      let attachment_path: string | null = null;
      if (file) {
        attachment_path = `${profile!.id}/${new Date().getFullYear()}/${crypto.randomUUID()}.${(file.name.split(".").pop() || "jpg").toLowerCase()}`;
        const up = await sb.storage.from("attachments").upload(attachment_path, file);
        if (up.error) throw new Error(up.error.message);
      }
      must(
        await sb.from("topups").insert({
          wallet_id: f.wallet_id,
          amount: toDecimalString(h),
          transfer_date: f.transfer_date,
          method: f.method,
          reference: f.reference.trim() || null,
          notes: f.notes.trim() || null,
          attachment_path,
        }),
      );
      return true;
    });
    if (ok) onSaved();
  }

  return (
    <Modal title={`${t("add")} ${t("topup")}`} onClose={onClose}>
      <div className="form">
        <Field label={t("wallet")}>
          <select value={f.wallet_id} onChange={(e) => setF({ ...f, wallet_id: e.target.value })}>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Field>
        <Field label={`${t("amount")} (SAR)`}>
          <input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label={t("date")}>
          <input type="date" value={f.transfer_date} onChange={(e) => setF({ ...f, transfer_date: e.target.value })} />
        </Field>
        <Field label={t("method")}>
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as TopupMethod })}>
            {METHODS.map((m) => (
              <option key={m} value={m}>{t(m === "cash" ? "cash" : m)}</option>
            ))}
          </select>
        </Field>
        <Field label={t("reference")}>
          <input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Bank transfer ref." />
        </Field>
        <Field label={t("attachment")}>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label={t("notes")} full>
          <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      <ErrorText error={action.error} />
      <div className="actions">
        <button onClick={onClose}>{t("cancel")}</button>
        <button className="primary" disabled={action.busy} onClick={save}>{t("save")}</button>
      </div>
    </Modal>
  );
}

function TopupDetail({ topup, onClose, onChanged }: { topup: Topup; onClose: () => void; onChanged: () => void }) {
  const { t, name } = useApp();
  const [reason, setReason] = useState("");
  const action = useAction();
  const file = useLoad(() => signedUrl("attachments", topup.attachment_path), [topup.attachment_path]);
  return (
    <Modal title={`${t("topup")} ${topup.external_id}`} onClose={onClose}>
      <dl className="kv">
        <dt>{t("status")}</dt>
        <dd><StatusBadge status={topup.status} /></dd>
        <dt>{t("wallet")}</dt>
        <dd>{name("wallets", topup.wallet_id)}</dd>
        <dt>{t("amount")}</dt>
        <dd><Money value={topup.amount} direction="in" /></dd>
        <dt>{t("date")}</dt>
        <dd>{topup.transfer_date}</dd>
        <dt>{t("reference")}</dt>
        <dd>{topup.reference || "—"}</dd>
        <dt>{t("notes")}</dt>
        <dd>{topup.notes || "—"}</dd>
        <dt>Entered by</dt>
        <dd>{name("profiles", topup.created_by)}</dd>
        <dt>{t("attachment")}</dt>
        <dd>{file.data ? <a href={file.data} target="_blank" rel="noreferrer">Open</a> : "—"}</dd>
        {topup.reversal_reason && (
          <>
            <dt>{t("reversed")}</dt>
            <dd>{topup.reversal_reason}</dd>
          </>
        )}
      </dl>
      {topup.status === "posted" && (
        <Field label={`${t("reason")} (${t("reverse")})`}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <ErrorText error={action.error} />
      <div className="actions">
        {topup.status === "posted" && (
          <button
            className="danger"
            disabled={action.busy || !reason.trim()}
            onClick={async () => {
              const ok = await action.run(async () => must(await supabase().rpc("reverse_topup", { p_id: topup.id, p_reason: reason })));
              if (ok) onChanged();
            }}
          >
            {t("reverse")}
          </button>
        )}
        <button onClick={onClose}>{t("cancel")}</button>
      </div>
    </Modal>
  );
}
