import { ScrollView } from "react-native";
import { useApp } from "@/lib/app";
import { useTheme, type ThemePref } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { Button, Card, Chips, T } from "@/components/ui";

export default function Settings() {
  const { t, locale, setLocale, profile, session } = useApp();
  const { pref, setPref } = useTheme();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card style={{ gap: 4 }}>
        <T bold size={18}>{profile?.full_name || session?.user.email}</T>
        <T muted>{session?.user.email}</T>
      </Card>
      <Card style={{ gap: 12 }}>
        <Chips<ThemePref>
          label={t("theme")}
          value={pref}
          onChange={setPref}
          options={[
            { value: "system", label: t("system") },
            { value: "light", label: `☀️ ${t("light")}` },
            { value: "dark", label: `🌙 ${t("dark")}` },
          ]}
        />
        <Chips<"en" | "ar">
          label="Language / اللغة"
          value={locale}
          onChange={setLocale}
          options={[
            { value: "en", label: "English" },
            { value: "ar", label: "العربية" },
          ]}
        />
      </Card>
      <Button kind="danger" title={t("signOut")} onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}
