import { NextResponse } from "next/server";

type ApiHandler = (
  request: Request,
  context: { params: Record<string, string> }
) => Promise<Response>;

export const withErrorHandler = (handler: ApiHandler): ApiHandler => {
  return async (request: Request, context: { params: Record<string, string> }) => {
    try {
      return await handler(request, context);
    } catch (error) {
      console.error(error);
      return NextResponse.json(
        { error: "Failed to process request" },
        { status: 500 }
      );
    }
  };
};

export const fetchJson = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
};
