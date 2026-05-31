/**
 * Admin-only audit log query endpoint.
 * GET /api/routes-d/audit?startDate=...&endDate=...&identifier=...&reason=...
 */

import { queryAuditLogs, getAuditSummary } from "../lib/auditLog.js";

// Simple admin check — in production, replace with proper RBAC
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

  const { searchParams } = new URL(request.url);

  const filters = {
    startDate: searchParams.get("startDate") || undefined,
    endDate: searchParams.get("endDate") || undefined,
    identifier: searchParams.get("identifier") || undefined,
    reason: searchParams.get("reason") || undefined,
    limit: searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : undefined,
    offset: searchParams.get("offset")
      ? parseInt(searchParams.get("offset")!, 10)
      : undefined,
  };

  const summary = searchParams.get("summary") === "true";
  const summaryHours = searchParams.get("hours")
    ? parseInt(searchParams.get("hours")!, 10)
    : 24;

  if (summary) {
    const result = getAuditSummary(summaryHours);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const result = queryAuditLogs(filters);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}