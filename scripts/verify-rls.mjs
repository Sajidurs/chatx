// One-off / repeatable smoke test: proves row-level security actually isolates
// tenants on a real Supabase project. Creates two businesses with one signed-in
// user each, confirms neither can read or write the other's rows, then cleans
// up everything it created.
//
// Usage: node --env-file=.env.local scripts/verify-rls.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const suffix = Math.random().toString(36).slice(2, 10);
const password = `Test-${suffix}-Aa1!`;

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

let businessA, businessB, userA, userB;

try {
  // --- Set up two tenants, each owned by a distinct auth user ---
  const { data: bizA, error: bizAErr } = await admin
    .from("businesses")
    .insert({ name: `RLS Test Business A ${suffix}` })
    .select()
    .single();
  if (bizAErr) throw bizAErr;
  businessA = bizA;

  const { data: bizB, error: bizBErr } = await admin
    .from("businesses")
    .insert({ name: `RLS Test Business B ${suffix}` })
    .select()
    .single();
  if (bizBErr) throw bizBErr;
  businessB = bizB;

  const { data: createdA, error: userAErr } = await admin.auth.admin.createUser({
    email: `rls-test-a-${suffix}@example.com`,
    password,
    email_confirm: true,
  });
  if (userAErr) throw userAErr;
  userA = createdA.user;

  const { data: createdB, error: userBErr } = await admin.auth.admin.createUser({
    email: `rls-test-b-${suffix}@example.com`,
    password,
    email_confirm: true,
  });
  if (userBErr) throw userBErr;
  userB = createdB.user;

  const { error: buAErr } = await admin
    .from("business_users")
    .insert({ business_id: businessA.id, auth_user_id: userA.id, email: userA.email, role: "owner" });
  if (buAErr) throw buAErr;

  const { error: buBErr } = await admin
    .from("business_users")
    .insert({ business_id: businessB.id, auth_user_id: userB.id, email: userB.email, role: "owner" });
  if (buBErr) throw buBErr;

  const { error: ksErr } = await admin
    .from("knowledge_sources")
    .insert({ business_id: businessA.id, type: "text", file_url: "https://example.com/a.txt" });
  if (ksErr) throw ksErr;

  // --- Sign in as user A (anon-key client, subject to RLS) ---
  const clientA = createClient(url, anonKey);
  const { error: signInAErr } = await clientA.auth.signInWithPassword({ email: userA.email, password });
  if (signInAErr) throw signInAErr;

  const { data: aOwnBusinesses } = await clientA.from("businesses").select("id");
  check(
    "user A sees exactly their own business, not B's",
    aOwnBusinesses?.length === 1 && aOwnBusinesses[0].id === businessA.id,
    `got ${JSON.stringify(aOwnBusinesses?.map((b) => b.id))}`
  );

  const { data: aReadB } = await clientA.from("businesses").select("id").eq("id", businessB.id);
  check("user A cannot read business B directly by id", (aReadB?.length ?? 0) === 0);

  const { data: aUpdateB } = await clientA
    .from("businesses")
    .update({ assistant_name: "hacked" })
    .eq("id", businessB.id)
    .select();
  check("user A cannot update business B", (aUpdateB?.length ?? 0) === 0);

  const { data: aKnowledge } = await clientA.from("knowledge_sources").select("id, business_id");
  check(
    "user A only sees knowledge_sources scoped to business A",
    (aKnowledge?.length ?? 0) === 1 && aKnowledge[0].business_id === businessA.id,
    `got ${JSON.stringify(aKnowledge)}`
  );

  // --- Sign in as user B, confirm the mirror image holds ---
  const clientB = createClient(url, anonKey);
  const { error: signInBErr } = await clientB.auth.signInWithPassword({ email: userB.email, password });
  if (signInBErr) throw signInBErr;

  const { data: bOwnBusinesses } = await clientB.from("businesses").select("id");
  check(
    "user B sees exactly their own business, not A's",
    bOwnBusinesses?.length === 1 && bOwnBusinesses[0].id === businessB.id,
    `got ${JSON.stringify(bOwnBusinesses?.map((b) => b.id))}`
  );

  const { data: bReadA } = await clientB.from("businesses").select("id").eq("id", businessA.id);
  check("user B cannot read business A directly by id", (bReadA?.length ?? 0) === 0);

  const { data: bBusinessUsersOfA } = await clientB
    .from("business_users")
    .select("id")
    .eq("business_id", businessA.id);
  check("user B cannot see business A's team members", (bBusinessUsersOfA?.length ?? 0) === 0);

  // plan_limits is public reference data -- both should read it fine.
  const { data: planLimits } = await clientA.from("plan_limits").select("plan");
  check("plan_limits reference table is readable", (planLimits?.length ?? 0) === 3);
} finally {
  // --- Clean up everything this script created ---
  if (businessA) await admin.from("businesses").delete().eq("id", businessA.id);
  if (businessB) await admin.from("businesses").delete().eq("id", businessB.id);
  if (userA) await admin.auth.admin.deleteUser(userA.id);
  if (userB) await admin.auth.admin.deleteUser(userB.id);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error("RLS VERIFICATION FAILED");
  process.exit(1);
}
console.log("RLS verification passed: tenants are isolated.");
