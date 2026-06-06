import { queryUserActivity } from "../lib/userActivity.js";

function isAdmin(request: Request): boolean {
  const adminToken = request.headers.get("x-admin-token");
  return adminToken === process.env.ROUTES_D_ADMIN_TOKEN;
}

export async function GET(request: Request): Promise<Response> {
  if (!isAdmin(request)) {
    return new Response(JSON.stringify({ error: "Forbidden", code: "ADMIN_REQUIRED" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const allowedActions = new Set(["login", "password_change", "payment_submit", "admin_action"]);

  const filters = {
    startDate: searchParams.get("startDate") || undefined,
    endDate: searchParams.get("endDate") || undefined,
    actor: searchParams.get("actor") || undefined,
    target: searchParams.get("target") || undefined,
    action:
      action && allowedActions.has(action)
        ? (action as "login" | "password_change" | "payment_submit" | "admin_action")
        : undefined,
    limit: searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined,
    offset: searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined,
  };

  const result = queryUserActivity(filters);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
