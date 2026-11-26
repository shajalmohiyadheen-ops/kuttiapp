"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useApp } from "@/lib/app-context";
import { RequireRole } from "@/components/shell";
import { Field } from "@/components/ui";

export default function InvitePage() {
  return (
    <RequireRole roles={["admin"]}>
      <Invite />
    </RequireRole>
  );
}

/**
 * Hands the phone app to a staff member: a QR code to scan, or a WhatsApp message with the link.
 * The link opens the install guide with their email filled in. The password is never put in the link.
 */
function Invite() {
  const { lookups } = useApp();
  const people = lookups.profiles.filter((p) => p.active && p.email);
  const [id, setId] = useState(people.find((p) => p.role === "custodian")?.id ?? people[0]?.id ?? "");
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const person = people.find((p) => p.id === id);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = person ? `${origin}/app/install?email=${encodeURIComponent(person.email ?? "")}` : `${origin}/app/install`;
  const message =
    `Hi ${person?.full_name || ""}, this is Express Cash for recording petty cash and card spending.\n\n` +
    `1. Open this link on your phone: ${link}\n` +
    `2. Follow the steps to put it on your home screen.\n` +
    `3. Sign in with ${person?.email ?? "your email"} and the password I give you.`;
  const phone = person?.phone?.replace(/\D/g, "");

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(link, { width: 520, margin: 1, color: { dark: "#020814", light: "#ffffff" } }).then((d) => live && setQr(d));
    return () => {
      live = false;
    };
  }, [link]);

  return (
    <>
      <h1>Invite staff</h1>
      <p className="muted">
        First add the person under <Link href="/users">Users</Link> with a password. Then show them this QR code, or send the message on WhatsApp.
        Tell them the password in person or by phone; it is not included in the link.
      </p>
      <div className="toolbar">
        <Field label="Person">
          <select value={id} onChange={(e) => (setId(e.target.value), setCopied(false))}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name || p.email} · {p.role === "custodian" ? "Field Staff" : p.role === "accounts" ? "Accounts" : "Super Admin"}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="invite">
        <div className="panel qr-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr ? <img src={qr} alt="QR code to install Express Cash" /> : <div className="muted">…</div>}
          <div className="small muted">Scan with the phone camera</div>
        </div>
        <div className="panel" style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <strong>WhatsApp message</strong>
          <pre className="message">{message}</pre>
          <div className="toolbar" style={{ margin: 0 }}>
            <button className="primary" onClick={async () => { await navigator.clipboard.writeText(message); setCopied(true); }}>{copied ? "Copied ✓" : "Copy message"}</button>
            <a className="btn" href={`https://wa.me/${phone ?? ""}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Open WhatsApp</a>
          </div>
          <div className="small muted">Link: {link}</div>
        </div>
      </div>
    </>
  );
}
