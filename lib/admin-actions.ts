"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "./admin-auth";

const COOKIE_MAX_AGE = 60 * 60 * 24; // 1 day

export async function loginAction(formData: FormData): Promise<void> {
  const password = formData.get("password");
  if (typeof password !== "string" || password !== ADMIN_PASSWORD) {
    redirect("/admin/login?error=1");
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE_NAME, ADMIN_PASSWORD, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    // "/" (not "/admin") so the browser also sends the session to the admin
    // agent's API routes under /api/admin/*. Still httpOnly + sameSite=lax.
    path: "/",
  });
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete({ name: ADMIN_COOKIE_NAME, path: "/" });
  redirect("/admin/login");
}
