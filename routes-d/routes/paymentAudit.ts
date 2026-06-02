import { queryPaymentAudits } from "../lib/paymentAudit.js";

// Simple admin check – replace with proper RBAC in production
function isAdmin(request: Request): boolean {
  const adminToken = request.headers.get("x-admin-token");
  return adminToken === process.env.ROUTES_D_ADMIN_TOKEN;
}

export async function GET(request: Request): Promise<Response> {
  if (!isAdmin(request)) {
    return new Response(
      JSON.stringify({ error: "Forbidden", code: "ADMIN_REQUIRED" }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  const entries = queryPaymentAudits();
  return new Response(JSON.stringify(entries), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
