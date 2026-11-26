import { useCallback, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { fromDb, sum, toDecimalString, type Expense } from "@kuttiapp/shared";
import { useApp } from "@/lib/app";
import { supabase, must } from "@/lib/supabase";
import { Button, Card, Money, StatusPill, T, useColors } from "@/components/ui";

export default function Home() {
  const { t, data, drafts, refresh, refreshDrafts, sync, online, session, locale, setLocale, profile } = useApp();
  const c = useColors();
  const [recent, setRecent] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      await Promise.all([
        refresh(),
        refreshDrafts(),
        supabase
          .from("expenses")
          .select("*")
          .eq("submitted_by", session.user.id)
          .order("created_at", { ascending: false })
          .limit(30)
          .then((r) => setRecent(must(r) as Expense[])),
      ]);
    } catch {
      // offline: keep cached data
    } finally {
      setLoading(false);
    }
  }, [session, refresh, refreshDrafts]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const projectName = (id: string) => {
    const p = data.projects.find((x) => x.id === id);
    return p ? `${p.code} ${locale === "ar" && p.name_ar ? p.name_ar : p.name}` : "";
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {!online && (
        <Card style={{ borderColor: c.warn }}>
          <T color={c.warn}>Offline. Balances are from {data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : "the last sync"}.</T>
        </Card>
      )}

      {data.wallets.length === 0 && (
        <Card>
          <T muted>No card or cash float is assigned to you yet. Ask finance to set one up.</T>
        </Card>
      )}

      {data.wallets.map((w) => {
        const queued = sum(drafts.filter((d) => d.wallet_id === w.wallet_id).map((d) => d.amount));
        const available = fromDb(w.available_balance) - queued;
        return (
          <Card key={w.wallet_id} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <T bold>{w.name}</T>
              <T muted>{w.kind === "card" ? `${t("card")} •••• ${w.card_last4 ?? ""}` : t("cash")}</T>
            </View>
            <T muted size={13}>{t("availableBalance")}</T>
            <Money value={toDecimalString(available)} size={28} bold />
            <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
              <T muted size={13}>
                {t("pending")}: <Money value={toDecimalString(fromDb(w.pending_total) + queued)} size={13} />
              </T>
              <T muted size={13}>
                {t("totalTopups")}: <Money value={w.topups_total} size={13} />
              </T>
            </View>
          </Card>
        );
      })}

      <Button kind="primary" title={`+ ${t("newExpense")}`} onPress={() => router.push("/expense/new")} disabled={data.wallets.length === 0} />

      {drafts.length > 0 && (
        <>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <T bold>{t("drafts")} ({drafts.length})</T>
            <Button
              title={t("submit")}
              disabled={!online}
              onPress={async () => {
                const r = await sync();
                if (r?.failed) Alert.alert(t("drafts"), `${r.sent} sent, ${r.failed} need attention.`);
              }}
            />
          </View>
          {drafts.map((d) => (
            <Pressable key={d.client_id} onPress={() => router.push({ pathname: "/expense/new", params: { draft: d.client_id } })}>
              <Card style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <T>{d.vendor || projectName(d.project_id)}</T>
                  <Money value={d.amount} bold />
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <T muted size={13}>{d.expense_date}</T>
                  <StatusPill status="draft" />
                </View>
                {d.last_error ? <T size={12} color={c.danger}>{d.last_error}</T> : null}
              </Card>
            </Pressable>
          ))}
        </>
      )}

      <T bold style={{ marginTop: 8 }}>{t("recent")}</T>
      {recent.length === 0 && <T muted>{t("noData")}</T>}
      {recent.map((e) => (
        <Pressable key={e.id} onPress={() => router.push({ pathname: "/expense/[id]", params: { id: e.id } })}>
          <Card style={{ gap: 4, borderColor: e.status === "changes_requested" ? c.warn : undefined }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <T>{e.vendor || projectName(e.project_id)}</T>
              <Money value={e.amount} bold />
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <T muted size={13}>
                {e.expense_date} · {projectName(e.project_id)}
              </T>
              <StatusPill status={e.status} />
            </View>
            {e.status === "changes_requested" && e.review_note ? <T size={13} color={c.warn}>{e.review_note}</T> : null}
          </Card>
        </Pressable>
      ))}

      <View style={{ flexDirection: "row", gap: 8, marginTop: 24 }}>
        <Button style={{ flex: 1 }} title={t("language")} onPress={() => setLocale(locale === "en" ? "ar" : "en")} />
        <Button style={{ flex: 1 }} kind="danger" title={t("signOut")} onPress={() => supabase.auth.signOut()} />
      </View>
      <T muted size={12}>{profile?.full_name ?? session?.user.email}</T>
    </ScrollView>
  );
}
