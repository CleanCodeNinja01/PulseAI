import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type UnsubscribePageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

async function unsubscribe(token: string | undefined) {
  if (!supabaseAdmin) {
    return {
      message: "Email preferences are temporarily unavailable.",
      title: "Could not update preferences",
    };
  }

  if (!token) {
    return {
      message: "This unsubscribe link is missing a token.",
      title: "Invalid unsubscribe link",
    };
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
    return {
      message: "We could not update your email preferences. Please try again.",
      title: "Could not update preferences",
    };
  }

  if (!data) {
    return {
      message: "This unsubscribe link is invalid or expired.",
      title: "Invalid unsubscribe link",
    };
  }

  return {
    message: "You have been unsubscribed from PulseAI digest and alert emails.",
    title: "You are unsubscribed",
  };
}

export default async function UnsubscribePage({
  searchParams,
}: UnsubscribePageProps) {
  const { token } = await searchParams;
  const result = await unsubscribe(token);

  return (
    <main className="unsubscribe-page">
      <section className="unsubscribe-card">
        <p className="unsubscribe-brand">PulseAI</p>
        <h1>{result.title}</h1>
        <p>{result.message}</p>
      </section>
    </main>
  );
}
