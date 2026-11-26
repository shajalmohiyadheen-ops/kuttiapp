import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle, useColorScheme } from "react-native";
import { formatSar } from "@kuttiapp/shared";
import { useApp } from "@/lib/app";

export const palette = {
  light: { bg: "#f6f7f9", card: "#ffffff", text: "#1b1f24", muted: "#5d6673", border: "#dfe3e8", brand: "#0f6e56", brandInk: "#ffffff", danger: "#b42318", warn: "#9a6700", ok: "#1a7f37" },
  dark: { bg: "#111418", card: "#1a1e23", text: "#e6e9ed", muted: "#9aa4b1", border: "#2d333b", brand: "#2fb38c", brandInk: "#0b1a14", danger: "#f97066", warn: "#e3b341", ok: "#56d364" },
};

export function useColors() {
  return palette[useColorScheme() === "dark" ? "dark" : "light"];
}

export function T({ children, muted, size = 15, bold, color, style }: { children: React.ReactNode; muted?: boolean; size?: number; bold?: boolean; color?: string; style?: object }) {
  const c = useColors();
  const { rtl } = useApp();
  return (
    <Text style={[{ color: color ?? (muted ? c.muted : c.text), fontSize: size, fontWeight: bold ? "700" : "400", writingDirection: rtl ? "rtl" : "ltr", textAlign: "left" }, style]}>
      {children}
    </Text>
  );
}

export function Money({ value, size = 15, bold }: { value: number | string | null | undefined; size?: number; bold?: boolean }) {
  const { locale } = useApp();
  const c = useColors();
  const neg = Number(value ?? 0) < 0;
  return (
    <T size={size} bold={bold} color={neg ? c.danger : undefined} style={{ fontVariant: ["tabular-nums"] }}>
      {formatSar(value, { locale })}
    </T>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14 }, style]}>{children}</View>;
}

export function Button({ title, onPress, kind = "default", disabled, busy, style }: { title: string; onPress: () => void; kind?: "primary" | "default" | "danger"; disabled?: boolean; busy?: boolean; style?: ViewStyle }) {
  const c = useColors();
  const bg = kind === "primary" ? c.brand : c.card;
  const fg = kind === "primary" ? c.brandInk : kind === "danger" ? c.danger : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        { backgroundColor: bg, borderColor: kind === "primary" ? c.brand : c.border, borderWidth: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: "600", fontSize: 15 }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  const c = useColors();
  const { rtl } = useApp();
  return (
    <View style={{ gap: 4 }}>
      <T muted size={13}>{label}</T>
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[{ borderColor: error ? c.danger : c.border, borderWidth: 1, borderRadius: 8, padding: 10, color: c.text, backgroundColor: c.card, fontSize: 16, textAlign: rtl ? "right" : "left" }, props.style]}
      />
      {error ? <T size={12} color={c.danger}>{error}</T> : null}
    </View>
  );
}

/** Horizontal chip picker: works the same on iOS and Android with no native picker dependency. */
export function Chips<V extends string>({ label, value, options, onChange }: { label: string; value: V | ""; options: Array<{ value: V; label: string }>; onChange: (v: V) => void }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <T muted size={13}>{label}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 99, borderWidth: 1, borderColor: on ? c.brand : c.border, backgroundColor: on ? c.brand : c.card }}
            >
              <Text style={{ color: on ? c.brandInk : c.text, fontSize: 14 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function StatusPill({ status }: { status: string }) {
  const c = useColors();
  const { t } = useApp();
  const color = status === "approved" ? c.ok : status === "rejected" || status === "reversed" ? c.danger : status === "draft" ? c.muted : c.warn;
  return (
    <View style={{ borderColor: color, borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color, fontSize: 12 }}>{status === "draft" ? t("drafts") : t(status as "pending")}</Text>
    </View>
  );
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
