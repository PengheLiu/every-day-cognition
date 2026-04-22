import { NextRequest } from "next/server";
import {
  findOrCreateUser,
  createSession,
  setSessionCookie,
  isValidChinesePhone,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { phone, nickname } = (await req.json()) as {
    phone?: string;
    nickname?: string;
  };

  if (!phone || !isValidChinesePhone(phone)) {
    return Response.json({ error: "手机号格式不正确" }, { status: 400 });
  }

  const trimmedNickname = (nickname || "").trim();
  if (!trimmedNickname) {
    return Response.json({ error: "请填写昵称" }, { status: 400 });
  }
  if (trimmedNickname.length > 20) {
    return Response.json({ error: "昵称最多 20 个字符" }, { status: 400 });
  }

  const user = findOrCreateUser(phone, trimmedNickname);
  const token = createSession(user.id);
  await setSessionCookie(token);

  return Response.json({
    ok: true,
    user: { id: user.id, phone: user.phone, nickname: user.nickname },
  });
}
