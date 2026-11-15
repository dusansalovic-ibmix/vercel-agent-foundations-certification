import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "./admin-auth";

/**
 * Server-side check for the demo admin session, used by the admin API routes
 * in addition to `proxy.ts` (defense in depth: route handlers never rely on
 * the proxy alone).
 */
export async function isAdminRequest(): Promise<boolean> {
  const store = await cookies();
  return store.get(ADMIN_COOKIE_NAME)?.value === ADMIN_PASSWORD;
}
