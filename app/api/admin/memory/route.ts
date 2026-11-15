import { isAdminRequest } from "@/lib/admin-session";
import { jsonError } from "@/lib/chat-route";
import { MEMORY_FILE, readMemoryFile } from "@/lib/sandbox";

/**
 * Read-only view of the admin agent's memory file, shown in the admin UI so
 * employees can see what the agent will remember in new conversations.
 */
export async function GET() {
  if (!(await isAdminRequest())) return jsonError(401, "Admin sign-in required.");
  try {
    const content = await readMemoryFile();
    return Response.json({ path: MEMORY_FILE, content });
  } catch (error) {
    console.error("[admin-memory] read failed", error);
    return jsonError(503, "The admin sandbox is unavailable right now.");
  }
}
