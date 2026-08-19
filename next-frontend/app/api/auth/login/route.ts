import { NextResponse } from "next/server";

import type { LoginDto, LoginTokenPair, ApiErrorEnvelope } from "@/lib/api/contracts";
import { upstreamUnavailableResponse } from "@/lib/api/upstream-error";
import { upstream } from "@/lib/api/upstream";
import { setSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = (await request.json()) as LoginDto;

  const upstreamResult = await upstream
    .POST("/auth/login", {
      body: body as never,
    })
    .catch(() => null);
  if (!upstreamResult) {
    return upstreamUnavailableResponse();
  }

  const { data, error, response } = upstreamResult;
  if (error) {
    return NextResponse.json<ApiErrorEnvelope>(error as ApiErrorEnvelope, {
      status: response.status,
    });
  }

  const tokens = data as LoginTokenPair;

  // Seal tokens into the iron-session cookie — tokens never cross to the browser.
  await setSession({
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token ?? "",
    userId: "",
    email: (body as Record<string, string>).email ?? "",
    channelSlug: "",
  });

  // FE-facing body omits access_token / refresh_token (per API Contract).
  return NextResponse.json({}, { status: 200 });
}
