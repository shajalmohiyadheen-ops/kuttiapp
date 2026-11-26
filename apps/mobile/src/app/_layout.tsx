import { DarkTheme, DefaultTheme, Redirect, Stack, ThemeProvider as NavThemeProvider, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider, useApp } from "@/lib/app";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { Background } from "@/components/ui";

function Root() {
  const { ready, session, rtl, t } = useApp();
  const { colors: c } = useTheme();
  const segments = useSegments();
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  const onLogin = segments[0] === "login";
  if (!session && !onLogin) return <Redirect href="/login" />;
  if (session && onLogin) return <Redirect href="/" />;
  const base = c.scheme === "dark" ? DarkTheme : DefaultTheme;
  // Transparent screens so the blue-violet gradient shows through everywhere.
  const navTheme = { ...base, colors: { ...base.colors, background: "transparent", card: c.bgTop, text: c.text, border: c.border, primary: c.brand } };
  return (
    <NavThemeProvider value={navTheme}>
    <Background>
      <View style={{ flex: 1, direction: rtl ? "rtl" : "ltr" }}>
        <StatusBar style={c.scheme === "dark" ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: c.bgTop },
            headerTintColor: c.text,
            headerShadowVisible: false,
            headerTitleStyle: { fontSize: 18, fontWeight: "700" },
            contentStyle: { backgroundColor: "transparent" },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="expense/quick" options={{ title: t("addExpense") }} />
          <Stack.Screen name="expense/new" options={{ title: t("moreDetails") }} />
          <Stack.Screen name="expense/[id]" options={{ title: t("expense") }} />
          <Stack.Screen name="settings" options={{ title: t("settings") }} />
        </Stack>
      </View>
    </Background>
    </NavThemeProvider>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppProvider>
          <Root />
        </AppProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
