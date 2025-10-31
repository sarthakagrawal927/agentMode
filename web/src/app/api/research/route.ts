import { NextResponse } from "next/server";
import { withErrorHandler, fetchJson } from "@/lib/api-utils";

const API_BASE =
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:8000/api";

export const POST = withErrorHandler(async (request: Request) => {
  const body = await request.json();
  const data = await fetchJson(`${API_BASE}/research`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return NextResponse.json(data);
});
