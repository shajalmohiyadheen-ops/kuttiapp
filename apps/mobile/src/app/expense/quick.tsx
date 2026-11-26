// The simple, step-by-step way to add an expense:
//   1. photo of the bill (the invoice QR code is read from the photo if there is one)
//   2. "Which project?"  hold the mic and say it, or tap / type
//   3. "How much?"       hold the mic and say it, or type (skipped when the QR gave the amount)
//   4. check everything (every value can be changed) and send
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, Switch, View } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { scanFromURLAsync } from "expo-camera";
import { formatSar, matchProjects, parseAmount, parseSpokenAmount, parseZatcaQr, toDecimalString, vatFromInclusive, type Project } from "@kuttiapp/shared";
import { useApp } from "@/lib/app";
import { useVoice } from "@/lib/voice";
import { getRecent, keepPhoto, rememberChoices, saveAndSend, saveDraft } from "@/lib/drafts";
import { Button, Card, Chips, Field, MicButton, Money, T, todayIso, useColors } from "@/components/ui";

type Step = "photo" | "project" | "amount" | "confirm";

export default function QuickExpense() {
  const { t, data, session, online, locale, refreshDrafts, refresh } = useApp();
  const c = useColors();
  const [step, setStep] = useState<Step>("photo");
  const [photo, setPhoto] = useState<string | null>(null);
  const [qr, setQr] = useState<ReturnType<typeof parseZatcaQr>>(null);
  const [projectId, setProjectId] = useState("");
  const [amount, setAmount] = useState(""); // decimal string
  const [vatOn, setVatOn] = useState(true);
  const [walletId, setWalletId] = useState(data.wallets[0]?.wallet_id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [speechLang, setSpeechLang] = useState<"ar-SA" | "en-US">(locale === "ar" ? "ar-SA" : "en-US");

  useEffect(() => {
    getRecent().then((r) => {
      setRecentProjects(r.projects.filter((id) => data.projects.some((p) => p.id === id)));
      if (r.category && data.categories.some((x) => x.id === r.category)) setCategoryId(r.category);
      if (r.wallet && data.wallets.some((w) => w.wallet_id === r.wallet)) setWalletId(r.wallet);
    });
  }, [data.projects, data.categories, data.wallets]);

  const projectLabel = (p: Project) => (locale === "ar" && p.name_ar ? p.name_ar : p.name);
  const project = data.projects.find((p) => p.id === projectId);
  const amountH = parseAmount(amount);

  async function takePhoto(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert(t("invoice"), "Permission is needed for the bill photo.");
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6 };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;
    const kept = await keepPhoto(res.assets[0].uri);
    setPhoto(kept);
    // Saudi tax invoices carry a QR code with the exact total and VAT: read it from the photo.
    let inv: ReturnType<typeof parseZatcaQr> = null;
    try {
      const codes = await scanFromURLAsync(kept, ["qr"]);
      inv = codes.map((x) => parseZatcaQr(x.data)).find(Boolean) ?? null;
    } catch {
      inv = null;
    }
    setQr(inv);
    if (inv) {
      setAmount(inv.total);
      setVatOn(Number(inv.vat) > 0);
    }
    setStep(projectId ? (inv || amount ? "confirm" : "amount") : "project");
  }

  function afterProject(id: string) {
    setProjectId(id);
    setStep(qr || amount ? "confirm" : "amount");
  }

  async function submit() {
    if (!session) return;
    if (amountH === null || amountH <= 0) return Alert.alert(t("howMuch"), t("invalidAmount"));
    if (!projectId) return setStep("project");
    if (!categoryId) return Alert.alert(t("category"), t("required"));
    if (!photo && amountH > data.invoiceRequiredAbove * 100) {
      return Alert.alert(t("invoice"), t("invoiceRequired", { amount: formatSar(data.invoiceRequiredAbove, { locale }) }), [
        { text: t("cancel"), style: "cancel" },
        { text: t("takePhoto"), onPress: () => setStep("photo") },
      ]);
    }
    const vatH = qr ? parseAmount(qr.vat) ?? 0 : vatOn ? vatFromInclusive(amountH) : 0;
    const form = {
      wallet_id: walletId,
      project_id: projectId,
      category_id: categoryId,
      expense_date: qr?.date ?? todayIso(),
      amount: toDecimalString(amountH),
      vat_amount: toDecimalString(vatH),
      vendor: qr?.sellerName ?? "",
      vendor_vat_number: qr && /^\d{15}$/.test(qr.vatNumber) ? qr.vatNumber : "",
      invoice_number: "",
      description: note,
      photo_uri: photo,
    };
    setBusy(true);
    try {
      const { result } = await saveAndSend(form, session.user.id, online);
      await rememberChoices(projectId, categoryId, walletId);
      await refreshDrafts();
      refresh().catch(() => {});
      if (result === "queued") Alert.alert(t("drafts"), t("offlineSaved"));
      router.back();
    } catch (e) {
      await refreshDrafts();
      Alert.alert(t("expense"), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function moreDetails() {
    const d = await saveDraft({
      wallet_id: walletId,
      project_id: projectId,
      category_id: categoryId,
      expense_date: qr?.date ?? todayIso(),
      amount: amountH !== null ? toDecimalString(amountH) : "",
      vat_amount: qr ? qr.vat : amountH !== null && vatOn ? toDecimalString(vatFromInclusive(amountH)) : "0.00",
      vendor: qr?.sellerName ?? "",
      vendor_vat_number: qr?.vatNumber ?? "",
      invoice_number: "",
      description: note,
      photo_uri: photo,
    });
    await refreshDrafts();
    router.replace({ pathname: "/expense/new", params: { draft: d.client_id } });
  }

  const langToggle = (
    <Chips<"ar-SA" | "en-US">
      label={t("speakLanguage")}
      value={speechLang}
      onChange={setSpeechLang}
      options={[
        { value: "en-US", label: "English" },
        { value: "ar-SA", label: "العربية" },
      ]}
    />
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <StepDots step={step} />

        {step === "photo" && (
          <View style={{ gap: 16 }}>
            <T size={24} bold>{t("takeBillPhoto")}</T>
            {photo ? <Image source={{ uri: photo }} style={{ width: "100%", height: 260, borderRadius: 16 }} resizeMode="contain" /> : null}
            <Button big kind="primary" icon="📷" title={photo ? t("retake") : t("takePhoto")} onPress={() => takePhoto(true)} />
            <Button icon="🖼️" title={t("choosePhoto")} onPress={() => takePhoto(false)} />
            <Button kind="ghost" title={photo ? t("next") : t("noBill")} onPress={() => setStep(projectId ? "amount" : "project")} />
          </View>
        )}

        {step === "project" && (
          <ProjectStep
            lang={speechLang}
            langToggle={langToggle}
            projects={data.projects}
            recent={recentProjects}
            label={projectLabel}
            onPick={afterProject}
            onBack={() => setStep("photo")}
          />
        )}

        {step === "amount" && (
          <AmountStep lang={speechLang} langToggle={langToggle} initial={amount} onDone={(v) => (setAmount(v), setStep("confirm"))} onBack={() => setStep("project")} />
        )}

        {step === "confirm" && (
          <View style={{ gap: 14 }}>
            <T size={24} bold>{t("confirmExpense")}</T>
            {qr ? <T color={c.ok}>✓ {t("fromInvoice")}{qr.sellerName ? ` · ${qr.sellerName}` : ""}</T> : null}

            <Card style={{ gap: 6 }}>
              <T muted size={14}>{t("amount")}</T>
              <Field label="" big value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" style={{ fontWeight: "700", color: c.moneyOut }} />
              {qr ? (
                <T muted size={14}>
                  {t("vat")}: <Money value={qr.vat} size={14} />
                </T>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <T size={15}>{t("vatIncluded")}</T>
                  <Switch value={vatOn} onValueChange={setVatOn} trackColor={{ true: c.brand, false: c.border }} />
                </View>
              )}
            </Card>

            <Card style={{ gap: 4 }} onPress={() => setStep("project")}>
              <T muted size={14}>{t("project")}</T>
              <T size={20} bold>{project ? `${projectLabel(project)}` : "—"}</T>
              <T muted size={13}>{t("tapToChange")}</T>
            </Card>

            {data.wallets.length > 1 && (
              <Chips
                label={t("wallet")}
                value={walletId}
                onChange={setWalletId}
                options={data.wallets.map((w) => ({ value: w.wallet_id, label: w.kind === "card" ? `💳 ${t("card")} ${w.card_last4 ?? ""}` : `💵 ${t("cash")}` }))}
              />
            )}

            <Chips
              label={t("category")}
              value={categoryId}
              onChange={setCategoryId}
              options={data.categories.map((x) => ({ value: x.id, label: locale === "ar" && x.name_ar ? x.name_ar : x.name }))}
            />

            <Card style={{ gap: 8 }} onPress={() => setStep("photo")}>
              {photo ? <Image source={{ uri: photo }} style={{ width: "100%", height: 140, borderRadius: 12 }} resizeMode="cover" /> : <T muted>📷 {t("noBill")}</T>}
              <T muted size={13}>{t("tapToChange")}</T>
            </Card>

            <Field label={`${t("notes")} (optional)`} value={note} onChangeText={setNote} />

            <Button big kind="primary" title={t("submit")} busy={busy} onPress={submit} />
            <Button kind="ghost" title={t("moreDetails")} onPress={moreDetails} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StepDots({ step }: { step: Step }) {
  const c = useColors();
  const order: Step[] = ["photo", "project", "amount", "confirm"];
  const i = order.indexOf(step);
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {order.map((s, k) => (
        <View key={s} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: k <= i ? c.brand : c.border }} />
      ))}
    </View>
  );
}

function ProjectStep({
  lang,
  langToggle,
  projects,
  recent,
  label,
  onPick,
  onBack,
}: {
  lang: "ar-SA" | "en-US";
  langToggle: React.ReactNode;
  projects: Project[];
  recent: string[];
  label: (p: Project) => string;
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  const { t } = useApp();
  const c = useColors();
  const hints = useMemo(() => projects.flatMap((p) => [p.name, p.code, p.name_ar ?? ""]).filter(Boolean), [projects]);
  const voice = useVoice(lang, hints);
  const [typing, setTyping] = useState(!voice.available);
  const [query, setQuery] = useState("");

  const heard = voice.final ? voice.transcript : "";
  const matches = useMemo(() => {
    if (!heard) return [];
    const best = new Map<string, number>();
    for (const alt of voice.alternatives.length ? voice.alternatives : [heard]) {
      for (const m of matchProjects(alt, projects)) best.set(m.project.id, Math.max(best.get(m.project.id) ?? 0, m.score));
    }
    return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => projects.find((p) => p.id === id)!);
  }, [heard, voice.alternatives, projects]);

  const typed = query.trim() ? matchProjects(query, projects, 6).map((m) => m.project) : [];
  const quick = [...recent.map((id) => projects.find((p) => p.id === id)).filter((p): p is Project => Boolean(p)), ...projects.filter((p) => !recent.includes(p.id))].slice(0, 6);

  const pickButton = (p: Project, primary = false) => (
    <Button key={p.id} kind={primary ? "primary" : "default"} big={primary} title={label(p)} onPress={() => onPick(p.id)} />
  );

  return (
    <View style={{ gap: 16 }}>
      <T size={24} bold>{t("whichProject")}</T>

      {voice.available && !typing && (
        <>
          <MicButton listening={voice.listening} onPressIn={voice.start} onPressOut={voice.stop} label={voice.listening ? t("listening") : t("holdToTalk")} />
          {voice.listening && voice.transcript ? <T center size={18}>“{voice.transcript}”</T> : null}
          {heard ? (
            <Card style={{ gap: 10 }}>
              <T muted>
                {t("heard")}: “{heard}”
              </T>
              {matches.length ? matches.map((p, k) => pickButton(p, k === 0)) : <T color={c.warn}>{t("notHeard")}</T>}
            </Card>
          ) : null}
          {voice.error && voice.error !== "no-speech" ? <T color={c.danger}>{voice.error === "permission" ? "Microphone permission is off." : voice.error}</T> : null}
          {voice.error === "no-speech" ? <T color={c.warn}>{t("notHeard")}</T> : null}
          {langToggle}
        </>
      )}

      {!voice.available && <T muted>{t("voiceUnavailable")}</T>}

      {typing ? (
        <>
          <Field label={t("search")} value={query} onChangeText={setQuery} autoFocus={voice.available} placeholder="ABB, P-001…" />
          {(query.trim() ? typed : quick).map((p) => pickButton(p))}
          {query.trim() && typed.length === 0 ? projects.map((p) => pickButton(p)) : null}
        </>
      ) : (
        <>
          {!heard && quick.length > 0 && (
            <View style={{ gap: 10 }}>
              {quick.slice(0, 4).map((p) => pickButton(p))}
            </View>
          )}
          <Button kind="ghost" icon="⌨️" title={t("typeInstead")} onPress={() => setTyping(true)} />
        </>
      )}
      <Button kind="ghost" title={t("back")} onPress={onBack} />
    </View>
  );
}

function AmountStep({ lang, langToggle, initial, onDone, onBack }: { lang: "ar-SA" | "en-US"; langToggle: React.ReactNode; initial: string; onDone: (v: string) => void; onBack: () => void }) {
  const { t, locale } = useApp();
  const c = useColors();
  const voice = useVoice(lang);
  const [typing, setTyping] = useState(!voice.available);
  const [value, setValue] = useState(initial);
  const [notUnderstood, setNotUnderstood] = useState(false);

  useEffect(() => {
    if (!voice.final || !voice.transcript) return;
    const candidates = voice.alternatives.length ? voice.alternatives : [voice.transcript];
    const h = candidates.map(parseSpokenAmount).find((x) => x !== null && x > 0) ?? null;
    if (h !== null) {
      setValue(toDecimalString(h));
      setNotUnderstood(false);
    } else {
      setNotUnderstood(true);
    }
  }, [voice.final, voice.transcript, voice.alternatives]);

  const h = parseAmount(value);
  return (
    <View style={{ gap: 16 }}>
      <T size={24} bold>{t("howMuch")}</T>
      {voice.available && !typing && (
        <>
          <MicButton listening={voice.listening} onPressIn={voice.start} onPressOut={voice.stop} label={voice.listening ? t("listening") : t("holdToTalk")} />
          {voice.transcript ? <T center muted>“{voice.transcript}”</T> : null}
          {notUnderstood ? <T color={c.warn} center>{t("notHeard")}</T> : null}
          {langToggle}
        </>
      )}
      {!voice.available && <T muted>{t("voiceUnavailable")}</T>}

      {h !== null && h > 0 && !typing ? (
        <Card style={{ alignItems: "center", gap: 4 }} onPress={() => setTyping(true)}>
          <T size={40} bold color={c.moneyOut}>
            {formatSar(toDecimalString(h), { locale })}
          </T>
          <T muted size={13}>{t("tapToChange")}</T>
        </Card>
      ) : null}

      {typing ? (
        <Field label={`${t("amount")} (SAR)`} big value={value} onChangeText={setValue} keyboardType="decimal-pad" autoFocus placeholder="0.00" style={{ fontWeight: "700" }} />
      ) : (
        <Button kind="ghost" icon="⌨️" title={t("typeInstead")} onPress={() => setTyping(true)} />
      )}

      <Button big kind="primary" title={t("next")} disabled={h === null || h <= 0} onPress={() => h !== null && onDone(toDecimalString(h))} />
      <Button kind="ghost" title={t("back")} onPress={onBack} />
    </View>
  );
}
