import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";

// One palette for the whole app. Money in is green, money out is red, everywhere.
export const palettes = {
  dark: {
    scheme: "dark" as const,
    bgTop: "#0b1030",
    bgBottom: "#24104a",
    bg: "#121638",
    card: "#1a1f4a",
    cardAlt: "#232a5e",
    border: "#323a7a",
    text: "#f1f2ff",
    muted: "#a9addb",
    brand: "#8b6cff",
    brand2: "#4f8bff",
    brandInk: "#ffffff",
    moneyIn: "#34d399",
    moneyOut: "#fb7185",
    warn: "#fbbf24",
    danger: "#fb7185",
    ok: "#34d399",
  },
  light: {
    scheme: "light" as const,
    bgTop: "#eef1ff",
    bgBottom: "#f6efff",
    bg: "#f3f4fb",
    card: "#ffffff",
    cardAlt: "#f1efff",
    border: "#e0e2f2",
    text: "#14163a",
    muted: "#5d628a",
    brand: "#5b3df5",
    brand2: "#2f6bea",
    brandInk: "#ffffff",
    moneyIn: "#13824a",
    moneyOut: "#d42a4c",
    warn: "#a86b00",
    danger: "#d42a4c",
    ok: "#13824a",
  },
};
export type Palette = (typeof palettes)["dark"] | (typeof palettes)["light"];
export type ThemePref = "system" | "light" | "dark";

const KEY = "kutti.theme";
const Ctx = createContext<{ pref: ThemePref; setPref: (p: ThemePref) => void; colors: Palette }>({
  pref: "system",
  setPref: () => {},
  colors: palettes.dark,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>("system");
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => (v === "light" || v === "dark" || v === "system") && setPrefState(v))
      .catch(() => {});
  }, []);
  const value = useMemo(() => {
    const scheme = pref === "system" ? (system === "light" ? "light" : "dark") : pref;
    return {
      pref,
      setPref: (p: ThemePref) => {
        setPrefState(p);
        AsyncStorage.setItem(KEY, p).catch(() => {});
      },
      colors: palettes[scheme],
    };
  }, [pref, system]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
