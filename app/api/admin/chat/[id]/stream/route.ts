import { isAdminRequest } from "@/lib/admin-session";
import { jsonError, resumeRunStream } from "@/lib/chat-route";

/** Resume an admin chat run's stream (admin session required). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminRequest())) return jsonError(401, "Admin sign-in required.");
  const { id } = await params;
  return resumeRunStream(request, id, "adminChatFlow");
}
