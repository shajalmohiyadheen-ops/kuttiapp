import type { Metadata, Viewport } from "next";
import "@fontsource-variable/roboto";
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

export const viewport: Viewport = { themeColor: "#020814", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("xc.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}` }} />
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
