#!/usr/bin/env node
// Loads demo data into a Supabase project: 4 users, 3 wallets, projects,
// categories, top-ups and expenses in every status.
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
  const financeId = await ensureUser("finance@expresscash.test", "Finance Admin", "admin");
  const pmId = await ensureUser("pm@expresscash.test", "Omar (Project Manager)", "approver");
  const ahmedId = await ensureUser("ahmed@expresscash.test", "Ahmed (Site Engineer)", "custodian");
  const saraId = await ensureUser("sara@expresscash.test", "Sara (Office)", "custodian");

  console.log("Master data…");
  const projects = ok(
    await admin
      .from("projects")
      .upsert(
        [
          { code: "P-001", name: "Riyadh villa fit-out", name_ar: "تشطيب فيلا الرياض", approver_id: pmId, budget: 50000 },
          { code: "P-002", name: "Jeddah office renovation", name_ar: "تجديد مكتب جدة", approver_id: pmId, budget: 30000 },
          { code: "ADM", name: "Head office admin", name_ar: "إدارة المكتب الرئيسي", approver_id: null },
        ],
        { onConflict: "code" },
      )
      .select(),
    "projects",
  );
  const P = Object.fromEntries(projects.map((p) => [p.code, p.id]));

  const categories = ok(
    await admin
      .from("categories")
      .upsert(
        [
          { name: "Fuel", name_ar: "وقود" },
          { name: "Materials", name_ar: "مواد" },
          { name: "Tools", name_ar: "أدوات" },
          { name: "Meals", name_ar: "وجبات" },
          { name: "Transport", name_ar: "نقل" },
          { name: "Office supplies", name_ar: "مستلزمات مكتبية" },
          { name: "Government fees", name_ar: "رسوم حكومية" },
        ],
        { onConflict: "name" },
      )
      .select(),
    "categories",
  );
  const C = Object.fromEntries(categories.map((c) => [c.name, c.id]));

  const wallets = ok(
    await admin
      .from("wallets")
      .insert([
        { name: "Ahmed - Alinma card", kind: "card", custodian_id: ahmedId, card_last4: "4417" },
        { name: "Ahmed - site cash", kind: "cash", custodian_id: ahmedId, bank_name: null },
        { name: "Sara - Alinma card", kind: "card", custodian_id: saraId, card_last4: "9032" },
      ])
      .select(),
    "wallets",
  );
  const [ahmedCard, ahmedCash, saraCard] = wallets.map((w) => w.id);

  console.log("Top-ups…");
  ok(
    await admin.from("topups").insert([
      { wallet_id: ahmedCard, amount: 10000, transfer_date: daysAgo(25), method: "bank_transfer", reference: "ALN-TRF-100231", created_by: financeId },
      { wallet_id: ahmedCard, amount: 5000, transfer_date: daysAgo(8), method: "bank_transfer", reference: "ALN-TRF-100877", created_by: financeId },
      { wallet_id: ahmedCash, amount: 2000, transfer_date: daysAgo(20), method: "cash", reference: "Cash voucher 17", created_by: financeId },
      { wallet_id: saraCard, amount: 3000, transfer_date: daysAgo(22), method: "bank_transfer", reference: "ALN-TRF-100402", created_by: financeId },
    ]),
    "topups",
  );

  console.log("Expenses…");
  const ahmed = await asUser("ahmed@expresscash.test");
  const sara = await asUser("sara@expresscash.test");
  const pm = await asUser("pm@expresscash.test");
  const finance = await asUser("finance@expresscash.test");

  const mk = async (client, userId, e) => {
    const invoice_path = e.amount > 100 ? await uploadInvoice(userId, crypto.randomUUID()) : null;
    return ok(await client.from("expenses").insert({ ...e, invoice_path, client_id: crypto.randomUUID() }).select().single(), `expense ${e.vendor}`);
  };

  const e1 = await mk(ahmed, ahmedId, { wallet_id: ahmedCard, project_id: P["P-001"], category_id: C.Materials, expense_date: daysAgo(18), amount: 2875.0, vat_amount: 375.0, vendor: "Saudi Ceramics", vendor_vat_number: "300000000000003", invoice_number: "SC-88123" });
  const e2 = await mk(ahmed, ahmedId, { wallet_id: ahmedCard, project_id: P["P-001"], category_id: C.Fuel, expense_date: daysAgo(15), amount: 230.0, vat_amount: 30.0, vendor: "SASCO", invoice_number: "SAS-5521" });
  const e3 = await mk(ahmed, ahmedId, { wallet_id: ahmedCard, project_id: P["P-002"], category_id: C.Tools, expense_date: daysAgo(10), amount: 1150.0, vat_amount: 150.0, vendor: "Saco", invoice_number: "SACO-7781" });
  const e4 = await mk(ahmed, ahmedId, { wallet_id: ahmedCash, project_id: P["P-001"], category_id: C.Meals, expense_date: daysAgo(9), amount: 86.25, vat_amount: 11.25, vendor: "Al Baik", description: "Lunch for site crew" });
  const e5 = await mk(ahmed, ahmedId, { wallet_id: ahmedCash, project_id: P["P-002"], category_id: C.Transport, expense_date: daysAgo(4), amount: 345.0, vat_amount: 45.0, vendor: "Careem", description: "Material delivery truck" });
  const e6 = await mk(ahmed, ahmedId, { wallet_id: ahmedCard, project_id: P["P-001"], category_id: C.Materials, expense_date: daysAgo(2), amount: 4600.0, vat_amount: 600.0, vendor: "Al Rajhi Steel", vendor_vat_number: "310000000000003", invoice_number: "ARS-1901" });
  const e7 = await mk(sara, saraId, { wallet_id: saraCard, project_id: P.ADM, category_id: C["Office supplies"], expense_date: daysAgo(12), amount: 517.5, vat_amount: 67.5, vendor: "Jarir Bookstore", invoice_number: "JR-44102" });
  const e8 = await mk(sara, saraId, { wallet_id: saraCard, project_id: P.ADM, category_id: C["Government fees"], expense_date: daysAgo(6), amount: 2000.0, vat_amount: 0, vendor: "Absher", description: "Iqama renewal fee" });
  const e9 = await mk(sara, saraId, { wallet_id: saraCard, project_id: P.ADM, category_id: C.Meals, expense_date: daysAgo(3), amount: 64.0, vat_amount: 8.35, vendor: "Starbucks", description: "Client meeting" });

  console.log("Approvals…");
  const review = async (client, id, decision, note) => ok(await client.rpc("review_expense", { p_id: id, p_decision: decision, p_note: note ?? null }), `review ${id}`);
  await review(pm, e1.id, "approve");
  await review(pm, e2.id, "approve");
  await review(pm, e3.id, "request_changes", "Please attach the full tax invoice, not the card slip.");
  await review(pm, e4.id, "approve");
  await review(finance, e7.id, "approve");
  await review(finance, e8.id, "approve");
  await review(finance, e9.id, "reject", "Personal coffee, not a business expense.");
  // e5 and e6 stay pending for the approval queue.
  void e5;
  void e6;

  console.log("Statement check…");
  // Ahmed's card: 15000 in, 2875 + 230 approved, 1150 + 4600 pending = 6145 calculated.
  ok(await finance.rpc("record_statement_check", { p_wallet_id: ahmedCard, p_statement_date: daysAgo(0), p_statement_balance: 6145, p_notes: "Matches Alinma app" }), "check");

  console.log(`\nDone. Sign in with any of these (password ${PASSWORD}):`);
  console.log("  finance@expresscash.test  Finance admin (web)");
  console.log("  pm@expresscash.test       Approver for P-001 and P-002 (web)");
  console.log("  ahmed@expresscash.test    Custodian with a card and a cash float (mobile)");
  console.log("  sara@expresscash.test     Custodian with a card (mobile)");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
