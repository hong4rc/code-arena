import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: { name: string; value: string; options?: unknown }[]) => {
          for (const c of toSet) {
            try {
              const opts = c.options as Parameters<typeof cookieStore.set>[2];
              if (opts) cookieStore.set(c.name, c.value, opts);
              else cookieStore.set(c.name, c.value);
            } catch {
              /* server components can't set cookies — ignore */
            }
          }
        },
      },
    },
  );
}

export async function getSessionUser() {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
