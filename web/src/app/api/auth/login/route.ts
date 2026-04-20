import { NextRequest } from "next/server";
import {
  verifyCode,
  findOrCreateUser,
  createSession,
  setSessionCookie,
  isValidChinesePhone,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { phone, code } = await req.json();

  if (!phone || !isValidChinesePhone(phone)) {
    return Response.json({ error: "手机号格式不正确" }, { status: 400 });
  }
  if (!code || !/^\d{6}$/.test(code)) {
    return Response.json({ error: "验证码应为 6 位数字" }, { status: 400 });
  }

  if (!verifyCode(phone, code)) {
    return Response.json({ error: "验证码错误或已过期" }, { status: 401 });
  }

  const user = findOrCreateUser(phone);
  const token = createSession(user.id);
  await setSessionCookie(token);

  return Response.json({
    ok: true,
    user: { id: user.id, phone: user.phone },
  });
}
