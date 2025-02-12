import { NextResponse } from "next/server";
import { withErrorHandler, fetchJson } from "@/lib/api-utils";

export const POST = withErrorHandler(async (request: Request) => {
  const body = await request.json();
  const data = await fetchJson("http://localhost:8000/api/research", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return NextResponse.json(data);
});
