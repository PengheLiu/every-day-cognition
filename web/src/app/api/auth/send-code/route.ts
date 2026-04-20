import { NextRequest } from "next/server";
import { issueVerifyCode, isValidChinesePhone } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { phone } = await req.json();

  if (!phone || !isValidChinesePhone(phone)) {
    return Response.json(
      { error: "手机号格式不正确，请输入 11 位大陆手机号" },
      { status: 400 }
    );
  }

  const code = issueVerifyCode(phone);

  // In dev mode, return the code so users don't need a real SMS gateway
  const devMode = process.env.NODE_ENV !== "production";
  return Response.json({
    ok: true,
    message: devMode ? `开发环境：验证码固定为 ${code}` : "验证码已发送，请查收",
    devCode: devMode ? code : undefined,
  });
}
