import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.ALERT_WEBHOOK_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !equal(supplied, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = await request.json() as { status?: string; alerts?: Array<Record<string, unknown>> };
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "warn",
    message: "alertmanager_webhook_received",
    status: payload.status,
    alertCount: payload.alerts?.length ?? 0
  })}\n`);
  return NextResponse.json({ accepted: true });
}

function equal(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

