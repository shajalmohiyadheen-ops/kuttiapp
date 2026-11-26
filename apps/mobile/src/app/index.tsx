import { useCallback, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { fromDb, sum, toDecimalString, type Expense } from "@kuttiapp/shared";
import { useApp } from "@/lib/app";
import { supabase, must } from "@/lib/supabase";
import { Button, Card, Logo, Money, StatusPill, T, useColors } from "@/components/ui";

export default function Home() {
  const { t, data, drafts, refresh, refreshDrafts, sync, online, session, locale } = useApp();
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
          .limit(20)
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
    return p ? (locale === "ar" && p.name_ar ? p.name_ar : p.name) : "";
  };
  const fixes = recent.filter((e) => e.status === "changes_requested");

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.text} />}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Logo height={42} />
          <Pressable accessibilityLabel={t("settings")} onPress={() => router.push("/settings")} hitSlop={12}>
            <T size={26}>⚙️</T>
          </Pressable>
        </View>

        {!online && (
          <Card style={{ borderColor: c.warn }}>
            <T color={c.warn}>Offline · {data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : ""}</T>
          </Card>
        )}

        {data.wallets.length === 0 && (
          <Card>
            <T muted>No card or cash is assigned to you yet. Ask finance.</T>
          </Card>
        )}

        {data.wallets.map((w) => {
          const queued = sum(drafts.filter((d) => d.wallet_id === w.wallet_id).map((d) => d.amount));
          const available = fromDb(w.available_balance) - queued;
          return (
            <Card key={w.wallet_id} style={{ gap: 6, backgroundColor: c.cardAlt }}>
              <T muted>
                {w.kind === "card" ? `💳 ${t("card")} •••• ${w.card_last4 ?? ""}` : `💵 ${t("cash")}`}
              </T>
              <Money value={toDecimalString(available)} size={34} bold />
              <T muted size={14}>{t("availableBalance")}</T>
            </Card>
          );
        })}

        <Button big kind="primary" icon="📷" title={t("addExpense")} onPress={() => router.push("/expense/quick")} disabled={data.wallets.length === 0} />

        {fixes.map((e) => (
          <Card key={e.id} style={{ borderColor: c.warn, borderWidth: 1.5, gap: 6 }} onPress={() => router.push({ pathname: "/expense/[id]", params: { id: e.id } })}>
            <T bold color={c.warn}>⚠️ {t("changes_requested")}</T>
            <T>{e.review_note}</T>
            <T muted size={14}>
              {projectName(e.project_id)} · <Money value={e.amount} size={14} direction="out" />
            </T>
          </Card>
        ))}

        {drafts.length > 0 && (
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <T bold>
                📤 {t("drafts")}: {drafts.length}
              </T>
              <Button
                title={t("submit")}
                disabled={!online}
                onPress={async () => {
                  const r = await sync();
                  if (r?.failed) Alert.alert(t("drafts"), `${r.sent} ✓  ${r.failed} ✗`);
                }}
              />
            </View>
            {drafts.map((d) => (
              <Pressable key={d.client_id} onPress={() => router.push({ pathname: "/expense/new", params: { draft: d.client_id } })}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <T>{projectName(d.project_id) || d.vendor}</T>
                  <Money value={d.amount} direction="out" />
                </View>
                {d.last_error ? <T size={13} color={c.danger}>{d.last_error}</T> : null}
              </Pressable>
            ))}
          </Card>
        )}

        <T bold size={18} style={{ marginTop: 6 }}>{t("recent")}</T>
        {recent.length === 0 && <T muted>{t("noData")}</T>}
        {recent.map((e) => (
          <Card key={e.id} style={{ paddingVertical: 12 }} onPress={() => router.push({ pathname: "/expense/[id]", params: { id: e.id } })}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T>{projectName(e.project_id)}</T>
                <T muted size={13}>
                  {e.expense_date}
                  {e.vendor ? ` · ${e.vendor}` : ""}
                </T>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Money value={e.amount} bold direction="out" />
                <StatusPill status={e.status} />
              </View>
            </View>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
