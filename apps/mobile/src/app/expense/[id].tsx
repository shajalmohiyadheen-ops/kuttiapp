import { useCallback, useState } from "react";
import { Image, ScrollView, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { Expense, ExpenseEvent } from "@kuttiapp/shared";
import { useApp } from "@/lib/app";
import { supabase, must } from "@/lib/supabase";
import { Button, Card, Money, StatusPill, T, useColors } from "@/components/ui";

export default function ExpenseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, data, locale } = useApp();
  const c = useColors();
  const [e, setE] = useState<Expense | null>(null);
  const [events, setEvents] = useState<ExpenseEvent[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const ex = must(await supabase.from("expenses").select("*").eq("id", id).single()) as Expense;
          setE(ex);
          setEvents(must(await supabase.from("expense_events").select("*").eq("expense_id", id).order("at")) as ExpenseEvent[]);
          if (ex.invoice_path) {
            const { data: u } = await supabase.storage.from("invoices").createSignedUrl(ex.invoice_path, 600);
            setPhoto(u?.signedUrl ?? null);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    }, [id]),
  );

  if (error) return <T color={c.danger} style={{ padding: 16 }}>{error}</T>;
  if (!e) return null;
  const project = data.projects.find((p) => p.id === e.project_id);
  const category = data.categories.find((x) => x.id === e.category_id);
  const wallet = data.wallets.find((w) => w.wallet_id === e.wallet_id);

  const row = (label: string, value: React.ReactNode) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 }}>
      <T muted>{label}</T>
      {typeof value === "string" ? <T style={{ flexShrink: 1 }}>{value}</T> : value}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Card style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T muted size={13}>{e.external_id}</T>
          <StatusPill status={e.status} />
        </View>
        <Money value={e.amount} size={30} bold direction="out" />
        {row(t("vat"), <Money value={e.vat_amount} />)}
        {row(t("date"), e.expense_date)}
        {row(t("wallet"), wallet?.name ?? "—")}
        {row(t("project"), project ? `${project.code} ${locale === "ar" && project.name_ar ? project.name_ar : project.name}` : "—")}
        {row(t("category"), category ? (locale === "ar" && category.name_ar ? category.name_ar : category.name) : "—")}
        {row(t("vendor"), e.vendor || "—")}
        {row(t("vendorVat"), e.vendor_vat_number || "—")}
        {row(t("invoiceNumber"), e.invoice_number || "—")}
        {e.description ? row(t("description"), e.description) : null}
      </Card>

      {e.review_note ? (
        <Card style={{ borderColor: e.status === "rejected" ? c.danger : c.warn }}>
          <T bold>{t("notes")}</T>
          <T>{e.review_note}</T>
        </Card>
      ) : null}

      {e.status === "changes_requested" && (
        <Button kind="primary" title={t("resubmit")} onPress={() => router.push({ pathname: "/expense/new", params: { edit: e.id } })} />
      )}

      {photo ? <Image source={{ uri: photo }} style={{ width: "100%", height: 360, borderRadius: 8 }} resizeMode="contain" /> : null}

      <Card style={{ gap: 4 }}>
        <T bold>{t("history")}</T>
        {events.map((ev) => (
          <T key={ev.id} size={13} muted>
            {new Date(ev.at).toLocaleString()} · {t(ev.to_status)}
            {ev.note ? ` · ${ev.note}` : ""}
          </T>
        ))}
      </Card>
    </ScrollView>
  );
}
