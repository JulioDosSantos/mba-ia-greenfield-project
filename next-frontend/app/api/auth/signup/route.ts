import { NextResponse } from "next/server";

import type { RegisterDto, RegisterResponse, ApiErrorEnvelope } from "@/lib/api/contracts";
import { upstreamUnavailableResponse } from "@/lib/api/upstream-error";
import { upstream } from "@/lib/api/upstream";

export async function POST(request: Request) {
  const body = (await request.json()) as RegisterDto;

  const upstreamResult = await upstream
    .POST("/auth/register", {
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

  return NextResponse.json<RegisterResponse>(data, { status: 201 });
}
