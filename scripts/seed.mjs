#!/usr/bin/env node
// Loads demo data into a Supabase project: an admin, accounts, two card holders with
// wallets, projects, categories, transfers, expenses and a cash withdrawal.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
//
// Use it on a test project. It refuses to run if expenses already exist,
// because demo rows can't be deleted afterwards (the schema forbids deletes).

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD ?? "ExpressDemo#2026";
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

function ok(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function asUser(email) {
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  ok(await c.auth.signInWithPassword({ email, password: PASSWORD }), `sign in ${email}`);
  return c;
}

async function ensureUser(email, full_name, role) {
  const list = ok(await admin.auth.admin.listUsers({ perPage: 1000 }), "list users");
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    user = ok(await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name, role } }), `create ${email}`).user;
  }
  ok(await admin.from("profiles").update({ full_name, role, active: true }).eq("id", user.id), `profile ${email}`);
  return user.id;
}

// 1x1 grey PNG used as the demo invoice photo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mN8/wcAAwAB/0Y1c8sAAAAASUVORK5CYII=", "base64");

async function uploadInvoice(userId, name) {
  const path = `${userId}/2026/${name}.png`;
  ok(await admin.storage.from("invoices").upload(path, PNG, { contentType: "image/png", upsert: true }), `upload ${path}`);
  return path;
}

function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const { count, error } = await admin.from("expenses").select("id", { count: "exact", head: true });
  if (error) throw new Error(`Is the migration applied? ${error.message}`);
  if ((count ?? 0) > 0 && !process.env.SEED_FORCE) {
    console.error(`This project already has ${count} expenses. Seed only an empty test project (or set SEED_FORCE=1).`);
    process.exit(1);
  }

  console.log("Users…");
  await ensureUser("admin@expresscash.test", "Super Admin", "admin");
  await ensureUser("accounts@expresscash.test", "Accounts Team", "accounts");
  const irfanId = await ensureUser("irfan@expresscash.test", "Irfan", "custodian");
  const anwarId = await ensureUser("anwar@expresscash.test", "Anwar", "custodian");

  console.log("Projects, categories, wallets…");
  const projects = ok(await admin.from("projects").upsert(
    ["ABB substation", "Riyadh villa fit-out", "Jeddah office", "Head office"].map((name) => ({ name })), { onConflict: "name" }).select(), "projects");
  const cats = [];
  for (const [name, receipt_required] of [["Materials", true], ["Fuel", true], ["Meals", true], ["Transport", true], ["Outside labour", false]]) {
    const found = ok(await admin.from("categories").select("*").eq("name", name), "categories")[0];
    cats.push(found ?? ok(await admin.from("categories").insert({ name, receipt_required }).select().single(), `category ${name}`));
  }
  const wallet = async (name, custodian_id, bank_name, card_last4) => {
    const found = ok(await admin.from("wallets").select("*").eq("custodian_id", custodian_id), "wallets")[0];
    return found ?? ok(await admin.from("wallets").insert({ name, custodian_id, bank_name, card_last4 }).select().single(), `wallet ${name}`);
  };
  const w1 = await wallet("Irfan's wallet", irfanId, "Alinma", "4417");
  const w2 = await wallet("Anwar's wallet", anwarId, "SNB", "9032");
  const P = Object.fromEntries(projects.map((p) => [p.name, p.id]));
  const C = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  console.log("Transfers in…");
  const sa = await asUser("admin@expresscash.test");
  ok(await sa.from("topups").insert([
    { wallet_id: w1.id, amount: 5000, transfer_date: daysAgo(12), method: "bank_transfer", reference: "Demo transfer" },
    { wallet_id: w2.id, amount: 3000, transfer_date: daysAgo(12), method: "bank_transfer", reference: "Demo transfer" },
  ]), "topups");

  console.log("Expenses and cash…");
  const irfan = await asUser("irfan@expresscash.test");
  const anwar = await asUser("anwar@expresscash.test");
  const bill = await uploadInvoice(irfanId, "demo-bill");
  ok(await irfan.from("cash_moves").insert({ wallet_id: w1.id, kind: "withdrawal", amount: 1500, move_date: daysAgo(6) }), "withdrawal");
  ok(await irfan.from("expenses").insert([
    { wallet_id: w1.id, submitted_by: irfanId, project_id: P["ABB substation"], category_id: C["Materials"], paid_by: "card", expense_date: daysAgo(3), amount: 2300, vat_amount: 300, vendor: "Al Rajhi Steel", invoice_path: bill },
    { wallet_id: w1.id, submitted_by: irfanId, project_id: P["ABB substation"], category_id: C["Outside labour"], paid_by: "cash", expense_date: daysAgo(2), amount: 1200, vat_amount: 0, vendor: "", description: "ABB project, paid to 2 labourers" },
  ]), "irfan expenses");
  ok(await anwar.from("expenses").insert(
    { wallet_id: w2.id, submitted_by: anwarId, project_id: P["Jeddah office"], category_id: C["Fuel"], paid_by: "card", expense_date: daysAgo(1), amount: 90, vat_amount: 11.74, vendor: "SASCO" },
  ), "anwar expenses");

  console.log(`Done. Sign in with any @expresscash.test user and password ${PASSWORD}.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
