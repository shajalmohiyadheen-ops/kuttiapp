import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// User management that needs the service role key (which must stay on the server):
//   POST  creates a login       { email, full_name, role, password }
//   PATCH resets a password     { id, password }
// Only an active admin may call either.

const ROLES = ["admin", "accounts", "custodian"];

async function adminClient(request: Request): Promise<{ admin: SupabaseClient; callerId: string } | Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return Response.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller, error } = await admin.auth.getUser(token);
  if (error || !caller.user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { data: p } = await admin.from("profiles").select("role, active").eq("id", caller.user.id).single();
  if (!p || p.role !== "admin" || !p.active) return Response.json({ error: "Only admins can manage users" }, { status: 403 });
  return { admin, callerId: caller.user.id };
}

export async function POST(request: Request) {
  const ctx = await adminClient(request);
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { email?: string; full_name?: string; role?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  const role = body?.role ?? "custodian";
  const password = body?.password ?? "";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "Enter a valid email" }, { status: 400 });
  if (!ROLES.includes(role)) return Response.json({ error: "Unknown role" }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  const { data, error } = await ctx.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: body?.full_name?.trim() ?? "", role },
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ id: data.user?.id });
}

export async function PATCH(request: Request) {
  const ctx = await adminClient(request);
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { id?: string; password?: string } | null;
  if (!body?.id) return Response.json({ error: "Missing user" }, { status: 400 });
  if ((body.password ?? "").length < 8) return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  const { error } = await ctx.admin.auth.admin.updateUserById(body.id, { password: body.password });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
