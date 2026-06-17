import { NextResponse } from "next/server";
import { summarizeUnreadArticles } from "@/lib/summarization";
import { isSupabaseAdminConfigured } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseAdminConfigured) {
    return NextResponse.json(
      { error: "Supabase admin client is not configured.", ok: false },
      { status: 500 },
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured.", ok: false },
      { status: 500 },
    );
  }

  try {
    const result = await summarizeUnreadArticles();

    return NextResponse.json({
      ok: result.failed === 0,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Summarization failed.",
        ok: false,
      },
      { status: 500 },
    );
  }
}
