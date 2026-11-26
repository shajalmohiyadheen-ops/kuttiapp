import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "@/lib/app";
import { supabase } from "@/lib/supabase";
import { Background, Button, Field, Logo, T, useColors } from "@/components/ui";

export default function Login() {
  const { t, locale, setLocale } = useApp();
  const c = useColors();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Background>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: 24 }}>
          <View style={{ gap: 18 }}>
            <View style={{ alignItems: "center", marginBottom: 12 }}>
              <Logo height={80} />
            </View>
            <Field label={t("email")} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
            <Field label={t("password")} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" />
            {error ? <T color={c.danger}>{error}</T> : null}
            <Button
              big
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
            <Button kind="ghost" title={t("language")} onPress={() => setLocale(locale === "en" ? "ar" : "en")} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Background>
  );
}
