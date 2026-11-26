import { createClient } from "@supabase/supabase-js";

// Creates a user account. Only callable by an active finance admin.
// Uses the service role key, which must stay on the server.
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return Response.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller.user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { data: callerProfile } = await admin.from("profiles").select("role, active").eq("id", caller.user.id).single();
  if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.active) {
    return Response.json({ error: "Only finance admins can add users" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { email?: string; full_name?: string; role?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  const role = body?.role ?? "custodian";
  const password = body?.password ?? "";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "Enter a valid email" }, { status: 400 });
  if (!["admin", "approver", "custodian"].includes(role)) return Response.json({ error: "Unknown role" }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "Temporary password must be at least 8 characters" }, { status: 400 });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: body?.full_name?.trim() ?? "", role },
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ id: data.user?.id });
}
