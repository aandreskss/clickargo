import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

/** Refresca la sesión y devuelve la respuesta (con cookies), el usuario y el nivel AAL. */
export async function updateSession(request: NextRequest, build: () => NextResponse) {
  let response = build();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = build();
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return {
    getResponse: () => response,
    user,
    currentLevel:  aalData?.currentLevel  ?? null,
    nextLevel:     aalData?.nextLevel     ?? null,
  };
}
