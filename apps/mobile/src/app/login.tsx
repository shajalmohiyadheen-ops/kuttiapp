import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "@/lib/app";
import { supabase } from "@/lib/supabase";
import { Button, Field, T, useColors } from "@/components/ui";

export default function Login() {
  const { t, locale, setLocale } = useApp();
  const c = useColors();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        <View style={{ gap: 16 }}>
          <T size={28} bold color={c.brand}>{t("appName")}</T>
          <Field label={t("email")} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
          <Field label={t("password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" />
          {error ? <T color={c.danger}>{error}</T> : null}
          <Button
            kind="primary"
            title={t("signIn")}
            busy={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
              setBusy(false);
              if (error) setError(error.message);
            }}
          />
          <Button title={t("language")} onPress={() => setLocale(locale === "en" ? "ar" : "en")} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
