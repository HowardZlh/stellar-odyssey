/**
 * @jest-environment node
 *
 * 运营邮件 Resend 适配测试（2026-09-22 替代 send_email 绑定）：请求体纯构造 /
 * 鉴权头与端点 / 非 2xx 抛错（供 opsNotify 回滚抢占）/ apiKey 缺失降级。
 */
import type { OpsMailMessage } from "../opsNotify";
import {
  buildResendBody,
  RESEND_API_URL,
  resendMailerOf,
  type FetchLike,
} from "../opsResend";

const BASE_MESSAGE: OpsMailMessage = {
  to: "stevenzearo@163.com",
  from: { email: "ops@mail.guushu.com", name: "Stellar Ops" },
  subject: "[Stellar Ops] 日报 2026-08-31",
  text: "== 漏斗转化 ==\n- 锁定提示曝光：20\n",
};

function fakeFetch(status: number) {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status };
  };
  return { fn, calls };
}

describe("buildResendBody", () => {
  it("显示名 <地址> + 单收件人数组 + 纯文本，且只含四个字段", () => {
    const body = buildResendBody(BASE_MESSAGE);
    expect(body).toEqual({
      from: "Stellar Ops <ops@mail.guushu.com>",
      to: ["stevenzearo@163.com"],
      subject: "[Stellar Ops] 日报 2026-08-31",
      text: "== 漏斗转化 ==\n- 锁定提示曝光：20\n",
    });
  });
});

describe("resendMailerOf", () => {
  it("apiKey 缺失 → null（not_configured 降级）", () => {
    const { fn } = fakeFetch(200);
    expect(resendMailerOf(undefined, fn)).toBeNull();
    expect(resendMailerOf("", fn)).toBeNull();
  });

  it("POST 到 Resend 端点，带 Bearer 与 JSON 体，2xx 正常返回", async () => {
    const { fn, calls } = fakeFetch(200);
    const mailer = resendMailerOf("re_test", fn)!;
    await mailer.send(BASE_MESSAGE);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(RESEND_API_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("Bearer re_test");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body)).toEqual(buildResendBody(BASE_MESSAGE));
  });

  it("非 2xx → 抛 resend_http_<status>", async () => {
    const { fn } = fakeFetch(422);
    const mailer = resendMailerOf("re_test", fn)!;
    await expect(mailer.send(BASE_MESSAGE)).rejects.toThrow("resend_http_422");
  });
});
