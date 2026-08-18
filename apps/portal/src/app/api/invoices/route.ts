import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { actorTokenFrom, backendFetch } from "../../../lib/backend";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const response = await backendFetch("/v1/invoices?limit=20", {}, actorTokenFrom(request));
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 503 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
    }
    const response = await backendFetch("/v1/invoices", {
      method: "POST",
      headers: { "idempotency-key": request.headers.get("idempotency-key") ?? `portal:${randomUUID()}` },
      body: JSON.stringify(await request.json())
    }, actorTokenFrom(request));
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 503 });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Backend unavailable";
}
