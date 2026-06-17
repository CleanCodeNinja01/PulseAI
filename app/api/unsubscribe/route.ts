import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function htmlResponse(message: string, status = 200) {
  return new NextResponse(
    `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>PulseAI unsubscribe</title>
        </head>
        <body style="font-family:Arial,sans-serif;background:#f9fafb;color:#111827;padding:48px;">
          <main style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px;">
            <p style="color:#7c3aed;font-weight:700;margin:0 0 8px;">PulseAI</p>
            <h1 style="margin:0 0 12px;">Email preferences updated</h1>
            <p style="line-height:1.6;margin:0;">${message}</p>
          </main>
        </body>
      </html>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
      status,
    },
  );
}

export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return htmlResponse("Email preferences are temporarily unavailable.", 500);
  }

  const token = new URL(request.url).searchParams.get("token");

  if (!token) {
    return htmlResponse("This unsubscribe link is missing a token.", 400);
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .update({
      email_unsubscribed_at: new Date().toISOString(),
    })
    .eq("email_unsubscribe_token", token)
    .select("id")
    .maybeSingle();

  if (error) {
    return htmlResponse("We could not update your email preferences.", 500);
  }

  if (!data) {
    return htmlResponse("This unsubscribe link is invalid or expired.", 404);
  }

  return htmlResponse("You have been unsubscribed from PulseAI digest emails.");
}
