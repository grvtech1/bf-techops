import { NextRequest, NextResponse } from "next/server";
import { actorTokenFrom, backendFetch } from "../../../lib/backend";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const response = await backendFetch("/v1/ops/summary", {}, actorTokenFrom(request));
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 503 });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Backend unavailable";
}
