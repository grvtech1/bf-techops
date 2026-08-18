const apiBaseUrl = process.env.API_INTERNAL_URL ?? "http://api:8080";

interface CachedToken {
  value: string;
  expiresAt: number;
}

let localToken: CachedToken | undefined;

export async function backendFetch(path: string, init: RequestInit = {}, suppliedActorToken?: string): Promise<Response> {
  const apiKey = process.env.PLATFORM_API_KEY;
  if (!apiKey) throw new Error("PLATFORM_API_KEY is required by the portal server");
  const token = await actorToken(apiKey, suppliedActorToken);
  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "authorization": `Bearer ${token}`,
      "x-platform-api-key": apiKey,
      "content-type": "application/json",
      ...init.headers
    }
  });
}

export function actorTokenFrom(request: NextRequest): string | undefined {
  return request.cookies.get("actor_token")?.value ??
    request.headers.get("x-amzn-oidc-accesstoken") ??
    undefined;
}

async function actorToken(apiKey: string, suppliedActorToken?: string): Promise<string> {
  if (suppliedActorToken) return suppliedActorToken;

  if (process.env.NODE_ENV === "production") {
    throw new Error("Actor session must be supplied by the production identity proxy");
  }
  if (localToken && localToken.expiresAt > Date.now() + 60_000) return localToken.value;

  const response = await fetch(`${apiBaseUrl}/v1/auth/dev-token`, {
    method: "POST",
    headers: { "x-platform-api-key": apiKey },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Development actor token request failed: ${response.status}`);
  const body = await response.json() as { token: string; expiresAt: string };
  localToken = { value: body.token, expiresAt: new Date(body.expiresAt).getTime() };
  return body.token;
}
import type { NextRequest } from "next/server";
