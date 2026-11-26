import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { formatSar } from "@kuttiapp/shared";
import { useApp } from "@/lib/app";
import { useTheme } from "@/lib/theme";

export function useColors() {
  return useTheme().colors;
}

/** Full-screen blue-to-violet background. */
export function Background({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <LinearGradient colors={[c.bgTop, c.bgBottom]} style={{ flex: 1 }}>
      {children}
    </LinearGradient>
  );
}

/** The KuttiApp logo. Replace apps/mobile/assets/logo.png with the real one (about 4:1). */
export function Logo({ height = 36 }: { height?: number }) {
  return <Image source={require("../../assets/logo.png")} style={{ height, width: height * 4 }} resizeMode="contain" accessibilityLabel="KuttiApp" />;
}

export function T({ children, muted, size = 16, bold, color, style, center }: { children: React.ReactNode; muted?: boolean; size?: number; bold?: boolean; color?: string; style?: object; center?: boolean }) {
  const c = useColors();
  const { rtl } = useApp();
  return (
    <Text
      style={[
        { color: color ?? (muted ? c.muted : c.text), fontSize: size, fontWeight: bold ? "700" : "400", writingDirection: rtl ? "rtl" : "ltr", textAlign: center ? "center" : "left" },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Amount in SAR. direction "out" shows red with a minus, "in" shows green with a plus. */
export function Money({ value, size = 16, bold, direction }: { value: number | string | null | undefined; size?: number; bold?: boolean; direction?: "in" | "out" }) {
  const { locale } = useApp();
  const c = useColors();
  const neg = Number(value ?? 0) < 0;
  const color = direction === "in" ? c.moneyIn : direction === "out" ? c.moneyOut : neg ? c.moneyOut : undefined;
  const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
  return (
    <T size={size} bold={bold} color={color} style={{ fontVariant: ["tabular-nums"] }}>
      {sign}
      {formatSar(value, { locale })}
    </T>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const c = useColors();
  const base: ViewStyle = { backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 16 };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, style, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  kind = "default",
  disabled,
  busy,
  style,
  big,
  icon,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "default" | "danger" | "ghost";
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
  big?: boolean;
  icon?: string;
}) {
  const c = useColors();
  const fg = kind === "primary" ? c.brandInk : kind === "danger" ? c.danger : kind === "ghost" ? c.muted : c.text;
  const inner = busy ? (
    <ActivityIndicator color={fg} />
  ) : (
    <Text style={{ color: fg, fontWeight: "700", fontSize: big ? 20 : 16, textAlign: "center" }}>
      {icon ? `${icon}  ` : ""}
      {title}
    </Text>
  );
  const shape: ViewStyle = { borderRadius: big ? 20 : 14, paddingVertical: big ? 22 : 14, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", minHeight: 52 };
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy} style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}>
      {kind === "primary" ? (
        <LinearGradient colors={[c.brand2, c.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={shape}>
          {inner}
        </LinearGradient>
      ) : (
        <View style={[shape, kind !== "ghost" && { backgroundColor: c.card, borderWidth: 1, borderColor: kind === "danger" ? c.danger : c.border }]}>{inner}</View>
      )}
    </Pressable>
  );
}

export function Field({ label, error, big, ...props }: TextInputProps & { label: string; error?: string | null; big?: boolean }) {
  const c = useColors();
  const { rtl } = useApp();
  return (
    <View style={{ gap: 6 }}>
      <T muted size={14}>{label}</T>
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[
          { borderColor: error ? c.danger : c.border, borderWidth: 1, borderRadius: 12, padding: 14, color: c.text, backgroundColor: c.card, fontSize: big ? 28 : 17, textAlign: rtl ? "right" : "left" },
          props.style,
        ]}
      />
      {error ? <T size={13} color={c.danger}>{error}</T> : null}
    </View>
  );
}

/** Big tappable choices that wrap. Same on iOS and Android. */
export function Chips<V extends string>({ label, value, options, onChange }: { label?: string; value: V | ""; options: Array<{ value: V; label: string }>; onChange: (v: V) => void }) {
  const c = useColors();
  return (
    <View style={{ gap: 8 }}>
      {label ? <T muted size={14}>{label}</T> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 99, borderWidth: 1.5, borderColor: on ? c.brand : c.border, backgroundColor: on ? c.brand : c.card }}
            >
              <Text style={{ color: on ? c.brandInk : c.text, fontSize: 16, fontWeight: on ? "700" : "400" }}>{o.label}</Text>
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
    <View style={{ borderColor: color, borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ color, fontSize: 13 }}>{status === "draft" ? t("drafts") : t(status as "pending")}</Text>
    </View>
  );
}

/** Hold-to-talk microphone button. */
export function MicButton({ listening, onPressIn, onPressOut, label }: { listening: boolean; onPressIn: () => void; onPressOut: () => void; label: string }) {
  const c = useColors();
  return (
    <View style={{ alignItems: "center", gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={({ pressed }) => ({ transform: [{ scale: pressed || listening ? 1.08 : 1 }] })}
      >
        <LinearGradient
          colors={listening ? [c.moneyOut, c.brand] : [c.brand2, c.brand]}
          style={{ width: 132, height: 132, borderRadius: 66, alignItems: "center", justifyContent: "center", borderWidth: listening ? 6 : 0, borderColor: c.cardAlt }}
        >
          <Text style={{ fontSize: 54 }}>🎤</Text>
        </LinearGradient>
      </Pressable>
      <T muted center>{label}</T>
    </View>
  );
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
