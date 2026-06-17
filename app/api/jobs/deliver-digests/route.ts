import { NextResponse } from "next/server";
import { deliverDueDigests } from "@/lib/email/digest";
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

  for (const envName of [
    "MAILJET_API_KEY",
    "MAILJET_SECRET_KEY",
    "DIGEST_FROM_EMAIL",
    "APP_URL",
  ]) {
    if (!process.env[envName]) {
      return NextResponse.json(
        { error: `${envName} is not configured.`, ok: false },
        { status: 500 },
      );
    }
  }

  try {
    const result = await deliverDueDigests();

    return NextResponse.json({
      ok: result.failed === 0,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Digest delivery failed.",
        ok: false,
      },
      { status: 500 },
    );
  }
}
