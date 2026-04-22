import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ user: null });
  return Response.json({
    user: { id: user.id, phone: user.phone, nickname: user.nickname },
  });
}
