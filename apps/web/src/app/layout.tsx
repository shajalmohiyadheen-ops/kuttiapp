import type { Metadata, Viewport } from "next";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource-variable/inter";
import "./globals.css";
import { AppProvider } from "@/lib/app-context";
import { Shell } from "@/components/shell";
import { RegisterSW } from "@/components/pwa";

export const metadata: Metadata = {
  title: "Express Cash",
  description: "Petty cash and company card tracker",
  icons: { icon: "/icon.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Express Cash", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#0b0b0c", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Before first paint: the saved theme, else follow the phone or computer setting (and keep following it until someone picks one). */}
        <script dangerouslySetInnerHTML={{ __html: `try{var d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: light)"),t=localStorage.getItem("xc.theme");d.dataset.theme=t==="light"||t==="dark"?t:m.matches?"light":"dark";m.addEventListener("change",function(e){if(!localStorage.getItem("xc.theme")){d.dataset.theme=e.matches?"light":"dark";window.dispatchEvent(new Event("xc-theme"))}})}catch(e){}` }} />
      </head>
      <body>
        <RegisterSW />
        <AppProvider>
          <Shell>{children}</Shell>
        </AppProvider>
      </body>
    </html>
  );
}
