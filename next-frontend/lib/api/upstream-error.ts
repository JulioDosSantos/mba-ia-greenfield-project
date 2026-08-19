import { NextResponse } from "next/server";

import type { ApiErrorEnvelope } from "@/lib/api/contracts";

export function upstreamUnavailableResponse(): NextResponse<ApiErrorEnvelope> {
  return NextResponse.json<ApiErrorEnvelope>(
    {
      statusCode: 503,
      error: "UPSTREAM_UNAVAILABLE",
      message: "Service temporarily unavailable",
      code: null,
    },
    { status: 503 },
  );
}
