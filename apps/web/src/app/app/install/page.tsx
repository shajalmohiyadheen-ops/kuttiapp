"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/ui";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Phone = "iphone" | "android";

/** Step-by-step "add to home screen", opened from the invite QR code. Works before signing in. */
export default function InstallPage() {
  const [phone, setPhone] = useState<Phone>("android");
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    const ua = navigator.userAgent;
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the browser
    setPhone(/iPhone|iPad|iPod/i.test(ua) ? "iphone" : "android");
    setEmail(params.get("email") ?? "");
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const onPrompt = (e: Event) => (e.preventDefault(), setPrompt(e as InstallPrompt));
    const onDone = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onDone);
    return () => (window.removeEventListener("beforeinstallprompt", onPrompt), window.removeEventListener("appinstalled", onDone));
  }, []);

  const signIn = `/app${email ? `?email=${encodeURIComponent(email)}` : ""}`;

  return (
    <div className="phone">
      <header><Wordmark /></header>
      <h1>📲 Put Express Cash on your phone</h1>
      <p className="muted" style={{ margin: 0 }}>It works like an app: an icon on your home screen, full screen, and it keeps your entries when there is no signal.</p>

      <div className="twin">
        <button className={`choice${phone === "iphone" ? " on" : ""}`} onClick={() => setPhone("iphone")}>iPhone</button>
        <button className={`choice${phone === "android" ? " on" : ""}`} onClick={() => setPhone("android")}>Android</button>
      </div>

      {installed ? (
        <div className="card">✓ Express Cash is installed. Open it from your home screen.</div>
      ) : phone === "iphone" ? (
        <ol className="steps">
          <li>Open this page in <b>Safari</b> (not Chrome or WhatsApp). If you came from WhatsApp, tap <b>⋯</b> and choose <b>Open in Safari</b>.</li>
          <li>Tap the <b>Share</b> button <span className="key">⬆︎</span> at the bottom of the screen.</li>
          <li>Scroll down and tap <b>Add to Home Screen</b> <span className="key">⊞</span>.</li>
          <li>Tap <b>Add</b> at the top right.</li>
          <li>Open <b>Express Cash</b> from your home screen and sign in.</li>
        </ol>
      ) : prompt ? (
        <button className="bigbtn" onClick={async () => { await prompt.prompt(); if ((await prompt.userChoice).outcome === "accepted") setInstalled(true); setPrompt(null); }}>
          📲 Install Express Cash
        </button>
      ) : (
        <ol className="steps">
          <li>Open this page in <b>Chrome</b>. If you came from WhatsApp, tap <b>⋮</b> and choose <b>Open in Chrome</b>.</li>
          <li>Tap the <b>⋮</b> menu at the top right.</li>
          <li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li>
          <li>Tap <b>Install</b> (or <b>Add</b>).</li>
          <li>Open <b>Express Cash</b> from your home screen and sign in.</li>
        </ol>
      )}

      <div className="card" style={{ display: "grid", gap: 6 }}>
        <strong>Signing in</strong>
        <div>Your email{email ? <> is <b>{email}</b></> : " is the one your admin registered"}. Your admin gives you the password. Forgot it? Ask your admin to reset it.</div>
      </div>
      <Link className="btn" href={signIn} style={{ textAlign: "center" }}>Open sign in →</Link>
    </div>
  );
}
