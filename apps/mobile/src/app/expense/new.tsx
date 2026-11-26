import { useEffect, useRef, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import { File } from "expo-file-system";
import { formatSar, parseAmount, parseZatcaQr, toDecimalString, vatFromInclusive, type Expense } from "@kuttiapp/shared";
import { useApp } from "@/lib/app";
import { supabase, must } from "@/lib/supabase";
import { keepPhoto, listDrafts, removeDraft, saveDraft, sendDraft, isNetworkError, type Draft } from "@/lib/drafts";
import { Button, Card, Chips, Field, T, todayIso, useColors } from "@/components/ui";

type Form = Omit<Draft, "client_id" | "saved_at" | "last_error">;

export default function NewExpense() {
  const { t, data, session, online, locale, refreshDrafts, refresh } = useApp();
  const c = useColors();
  const params = useLocalSearchParams<{ draft?: string; edit?: string }>();
  const [clientId, setClientId] = useState<string | undefined>(params.draft);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<Form>({
    wallet_id: data.wallets[0]?.wallet_id ?? "",
    project_id: "",
    category_id: "",
    expense_date: todayIso(),
    amount: "",
    vat_amount: "",
    vendor: "",
    vendor_vat_number: "",
    invoice_number: "",
    description: "",
    photo_uri: null,
  });
  const [remotePhoto, setRemotePhoto] = useState<string | null>(null);
  const [qrFilled, setQrFilled] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Load a draft or an expense being resubmitted.
  useEffect(() => {
    if (params.draft) {
      listDrafts().then((ds) => {
        const d = ds.find((x) => x.client_id === params.draft);
        if (d) {
          const { client_id: _c, saved_at: _s, last_error: _e, ...rest } = d;
          setForm(rest);
        }
      });
    } else if (params.edit) {
      supabase
        .from("expenses")
        .select("*")
        .eq("id", params.edit)
        .single()
        .then(async (r) => {
          const e = must(r) as Expense;
          setEditing(e);
          setForm({
            wallet_id: e.wallet_id,
            project_id: e.project_id,
            category_id: e.category_id,
            expense_date: e.expense_date,
            amount: String(e.amount),
            vat_amount: String(e.vat_amount),
            vendor: e.vendor,
            vendor_vat_number: e.vendor_vat_number ?? "",
            invoice_number: e.invoice_number ?? "",
            description: e.description ?? "",
            photo_uri: null,
          });
          if (e.invoice_path) {
            const { data: u } = await supabase.storage.from("invoices").createSignedUrl(e.invoice_path, 600);
            setRemotePhoto(u?.signedUrl ?? null);
          }
        });
    }
  }, [params.draft, params.edit]);

  async function pickPhoto(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t("invoice"), "Permission is needed to attach the invoice photo.");
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6, allowsEditing: false, exif: false };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;
    const kept = await keepPhoto(res.assets[0].uri);
    set("photo_uri", kept);
  }

  function onQr(payload: string) {
    const inv = parseZatcaQr(payload);
    setScanning(false);
    if (!inv) {
      Alert.alert(t("scanQr"), "This QR code is not a Saudi e-invoice code. Enter the details by hand.");
      return;
    }
    setForm((f) => ({
      ...f,
      vendor: inv.sellerName,
      vendor_vat_number: /^\d{15}$/.test(inv.vatNumber) ? inv.vatNumber : f.vendor_vat_number,
      amount: inv.total,
      vat_amount: inv.vat,
      expense_date: inv.date ?? f.expense_date,
    }));
    setQrFilled(true);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    const amt = parseAmount(form.amount);
    if (amt === null || amt <= 0) e.amount = t("invalidAmount");
    const vat = form.vat_amount ? parseAmount(form.vat_amount) : 0;
    if (vat === null || (amt !== null && vat > amt)) e.vat_amount = t("invalidAmount");
    if (!form.wallet_id) e.wallet_id = t("required");
    if (!form.project_id) e.project_id = t("required");
    if (!form.category_id) e.category_id = t("required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.expense_date)) e.expense_date = "YYYY-MM-DD";
    if (form.vendor_vat_number && !/^\d{15}$/.test(form.vendor_vat_number.trim())) e.vendor_vat_number = "15 digits";
    if (amt !== null && amt > data.invoiceRequiredAbove * 100 && !form.photo_uri && !remotePhoto) {
      e.photo = t("invoiceRequired", { amount: formatSar(data.invoiceRequiredAbove, { locale }) });
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function normalized(): Form {
    return {
      ...form,
      amount: toDecimalString(parseAmount(form.amount) ?? 0),
      vat_amount: toDecimalString(form.vat_amount ? parseAmount(form.vat_amount) ?? 0 : 0),
    };
  }

  async function saveAsDraft(silent = false) {
    const d = await saveDraft({ ...normalized(), client_id: clientId });
    setClientId(d.client_id);
    await refreshDrafts();
    if (!silent) router.back();
    return d;
  }

  async function submit() {
    if (!validate() || !session) return;
    setBusy(true);
    try {
      if (editing) {
        await resubmit(editing.id);
      } else {
        const d = await saveAsDraft(true); // saved first, so nothing is lost if the send fails
        if (!online) {
          Alert.alert(t("drafts"), t("offlineSaved"));
          router.back();
          return;
        }
        try {
          await sendDraft(d, session.user.id);
          await removeDraft(d.client_id);
          await refreshDrafts();
          refresh().catch(() => {});
          router.back();
        } catch (e) {
          if (isNetworkError(e)) {
            Alert.alert(t("drafts"), t("offlineSaved"));
            router.back();
          } else {
            Alert.alert(t("expense"), e instanceof Error ? e.message : String(e));
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function resubmit(id: string) {
    if (!session) return;
    const f = normalized();
    try {
      let newPath: string | null = null;
      if (f.photo_uri) {
        const ext = f.photo_uri.split(".").pop() || "jpg";
        newPath = `${session.user.id}/${f.expense_date.slice(0, 4)}/${id}-${Date.now()}.${ext}`;
        const body = await new File(f.photo_uri).arrayBuffer();
        const up = await supabase.storage.from("invoices").upload(newPath, body, { contentType: "image/jpeg" });
        if (up.error) throw new Error(up.error.message);
      }
      must(
        await supabase.rpc("resubmit_expense", {
          p_id: id,
          p_amount: f.amount,
          p_vat_amount: f.vat_amount,
          p_project_id: f.project_id,
          p_category_id: f.category_id,
          p_expense_date: f.expense_date,
          p_vendor: f.vendor,
          p_vendor_vat_number: f.vendor_vat_number,
          p_invoice_number: f.invoice_number,
          p_description: f.description,
          p_invoice_path: newPath,
        }),
      );
      refresh().catch(() => {});
      router.back();
    } catch (e) {
      Alert.alert(t("resubmit"), e instanceof Error ? e.message : String(e));
    }
  }

  const amountH = parseAmount(form.amount);
  const photo = form.photo_uri ?? remotePhoto;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        {editing?.review_note ? (
          <Card style={{ borderColor: c.warn }}>
            <T color={c.warn}>{editing.review_note}</T>
          </Card>
        ) : null}

        <Card style={{ gap: 10 }}>
          <T bold>{t("invoice")}</T>
          {photo ? <Image source={{ uri: photo }} style={{ width: "100%", height: 220, borderRadius: 8 }} resizeMode="contain" /> : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button style={{ flex: 1 }} title={t("takePhoto")} onPress={() => pickPhoto(true)} />
            <Button style={{ flex: 1 }} title={t("choosePhoto")} onPress={() => pickPhoto(false)} />
          </View>
          <Button title={t("scanQr")} onPress={() => setScanning(true)} />
          {qrFilled ? <T size={13} color={c.ok}>✓ {t("qrFilled")}</T> : null}
          {errors.photo ? <T size={13} color={c.danger}>{errors.photo}</T> : null}
        </Card>

        <Chips
          label={t("wallet")}
          value={form.wallet_id}
          onChange={(v) => set("wallet_id", v)}
          options={data.wallets.map((w) => ({ value: w.wallet_id, label: w.kind === "card" ? `${t("card")} ${w.card_last4 ?? ""}` : `${t("cash")} · ${w.name}` }))}
        />
        {errors.wallet_id ? <T size={12} color={c.danger}>{errors.wallet_id}</T> : null}

        <Field label={`${t("amount")} (SAR)`} value={form.amount} onChangeText={(v) => set("amount", v)} keyboardType="decimal-pad" error={errors.amount} placeholder="0.00" />
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <Field label={t("vat")} value={form.vat_amount} onChangeText={(v) => set("vat_amount", v)} keyboardType="decimal-pad" error={errors.vat_amount} placeholder="0.00" />
          </View>
          <Button title="15%" disabled={amountH === null} onPress={() => amountH !== null && set("vat_amount", toDecimalString(vatFromInclusive(amountH)))} />
          <Button title="0" onPress={() => set("vat_amount", "0.00")} />
        </View>

        <Chips
          label={t("project")}
          value={form.project_id}
          onChange={(v) => set("project_id", v)}
          options={data.projects.map((p) => ({ value: p.id, label: `${p.code} ${locale === "ar" && p.name_ar ? p.name_ar : p.name}` }))}
        />
        {errors.project_id ? <T size={12} color={c.danger}>{errors.project_id}</T> : null}
        <Chips
          label={t("category")}
          value={form.category_id}
          onChange={(v) => set("category_id", v)}
          options={data.categories.map((x) => ({ value: x.id, label: locale === "ar" && x.name_ar ? x.name_ar : x.name }))}
        />
        {errors.category_id ? <T size={12} color={c.danger}>{errors.category_id}</T> : null}

        <Field label={`${t("date")} (YYYY-MM-DD)`} value={form.expense_date} onChangeText={(v) => set("expense_date", v)} error={errors.expense_date} />
        <Field label={t("vendor")} value={form.vendor} onChangeText={(v) => set("vendor", v)} />
        <Field label={t("vendorVat")} value={form.vendor_vat_number} onChangeText={(v) => set("vendor_vat_number", v)} keyboardType="number-pad" maxLength={15} error={errors.vendor_vat_number} />
        <Field label={t("invoiceNumber")} value={form.invoice_number} onChangeText={(v) => set("invoice_number", v)} />
        <Field label={t("description")} value={form.description} onChangeText={(v) => set("description", v)} multiline style={{ minHeight: 70 }} />

        <Button kind="primary" title={editing ? t("resubmit") : t("submit")} busy={busy} onPress={submit} />
        {!editing && <Button title={t("saveDraft")} onPress={() => saveAsDraft()} />}
        {!editing && clientId && (
          <Button
            kind="danger"
            title={t("cancel")}
            onPress={() =>
              Alert.alert(t("drafts"), "Delete this draft?", [
                { text: t("cancel"), style: "cancel" },
                { text: "OK", style: "destructive", onPress: async () => (await removeDraft(clientId), await refreshDrafts(), router.back()) },
              ])
            }
          />
        )}
      </ScrollView>
      <QrScanner visible={scanning} onClose={() => setScanning(false)} onScan={onQr} />
    </KeyboardAvoidingView>
  );
}

function QrScanner({ visible, onClose, onScan }: { visible: boolean; onClose: () => void; onScan: (data: string) => void }) {
  const [perm, requestPerm] = useCameraPermissions();
  const { t } = useApp();
  const handled = useRef(false);
  useEffect(() => {
    if (visible) handled.current = false;
  }, [visible]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {perm?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(r) => {
              if (handled.current) return;
              handled.current = true;
              onScan(r.data);
            }}
          />
        ) : (
          <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
            <T color="#fff">Camera permission is needed to scan the invoice QR code.</T>
            <Button title="Allow camera" onPress={requestPerm} />
          </View>
        )}
        <View style={{ padding: 24 }}>
          <T color="#fff" size={13}>{t("scanQr")}</T>
          <Button title={t("cancel")} onPress={onClose} style={{ marginTop: 8 }} />
        </View>
      </View>
    </Modal>
  );
}
