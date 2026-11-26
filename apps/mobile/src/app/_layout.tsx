import { Stack, Redirect, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider, useApp } from "@/lib/app";
import { useColors } from "@/components/ui";

function Root() {
  const { ready, session, rtl, t } = useApp();
  const c = useColors();
  const segments = useSegments();
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  const onLogin = segments[0] === "login";
  if (!session && !onLogin) return <Redirect href="/login" />;
  if (session && onLogin) return <Redirect href="/" />;
  return (
    <View style={{ flex: 1, direction: rtl ? "rtl" : "ltr", backgroundColor: c.bg }}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.card },
          headerTintColor: c.text,
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: t("appName") }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="expense/new" options={{ title: t("newExpense"), presentation: "modal" }} />
        <Stack.Screen name="expense/[id]" options={{ title: t("expense") }} />
      </Stack>
    </View>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Root />
      </AppProvider>
    </SafeAreaProvider>
  );
}
