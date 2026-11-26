import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";

// One palette for the whole app. Money in is green, money out is red, everywhere.
// Taken from the KuttiApp logo: navy base, coral -> pink -> violet gradient.
// Money in is green and money out is a pure red, kept away from the logo's coral.
export const palettes = {
  dark: {
    scheme: "dark" as const,
    bgTop: "#07071f",
    bgBottom: "#170b38",
    bg: "#0b0b26",
    card: "#141435",
    cardAlt: "#1d1846",
    border: "#2c2860",
    text: "#f4f2ff",
    muted: "#a9a6d6",
    brand: "#8a4dff", // violet
    brand2: "#ff5a6e", // coral
    brandMid: "#f052b4", // pink
    brandInk: "#ffffff",
    arc: "#d946ef",
    moneyIn: "#2ee59d",
    moneyOut: "#ff3b3b",
    warn: "#ffc247",
    danger: "#ff3b3b",
    ok: "#2ee59d",
  },
  light: {
    scheme: "light" as const,
    bgTop: "#fbf7ff",
    bgBottom: "#f1ecff",
    bg: "#f7f4ff",
    card: "#ffffff",
    cardAlt: "#f5efff",
    border: "#e6def7",
    text: "#17132f",
    muted: "#625b88",
    brand: "#7a3cf0",
    brand2: "#f0485f",
    brandMid: "#d93ea0",
    brandInk: "#ffffff",
    arc: "#c026d3",
    moneyIn: "#0f8a52",
    moneyOut: "#d61f1f",
    warn: "#a86b00",
    danger: "#d61f1f",
    ok: "#0f8a52",
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
