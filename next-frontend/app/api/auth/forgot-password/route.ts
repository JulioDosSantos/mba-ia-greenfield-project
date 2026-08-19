import { NextResponse } from "next/server";

import type { ForgotPasswordDto, ApiErrorEnvelope } from "@/lib/api/contracts";
import { upstreamUnavailableResponse } from "@/lib/api/upstream-error";
import { upstream } from "@/lib/api/upstream";

export async function POST(request: Request) {
  const body = (await request.json()) as ForgotPasswordDto;

  const upstreamResult = await upstream
    .POST("/auth/forgot-password", {
      body: body as never,
    })
    .catch(() => null);
  if (!upstreamResult) {
    return upstreamUnavailableResponse();
  }

  const { error, response } = upstreamResult;

  if (error) {
    return NextResponse.json<ApiErrorEnvelope>(error as ApiErrorEnvelope, {
      status: response.status,
    });
  }

  // 204 pass-through — identical whether email is registered or not (anti-enumeration).
  return new Response(null, { status: 204 });
}
