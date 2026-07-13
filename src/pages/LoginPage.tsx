import { useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "../components/Icon";

export function LoginPage({ onLogin, error, submitting }: {
  onLogin: (input: { tokenText: string; cookie: string; sign: string; target: string }) => void;
  error?: string | null;
  submitting?: boolean;
}) {
  const [token, setToken] = useState("");
  const [cookie, setCookie] = useState("");
  const [sign, setSign] = useState("");
  const [target, setTarget] = useState("https://cis.whng.com.cn");
  return <section className="login-screen"><div className="login-mark"><span><Icon name="check" size={26} /></span></div><p className="eyebrow">KiDinDin · 原生会话</p><h1>到访不遇批量处理</h1><p className="login-copy">粘贴登录响应 JSON 或 Bearer token。请求由安卓原生层发出，令牌不会写入网页存储。</p><label className="token-field"><span>登录凭据</span><textarea value={token} onChange={(event) => setToken(event.target.value)} placeholder={'Bearer eyJ...\n或粘贴包含 access_token 的登录响应 JSON'} /></label><details className="login-extra"><summary>请求附加信息（Cookie / sign）</summary><label><span>Cookie（可选）</span><input value={cookie} onChange={(event) => setCookie(event.target.value)} placeholder="JSESSIONID=..." /></label><label><span>sign（接口要求时填写）</span><input value={sign} onChange={(event) => setSign(event.target.value)} placeholder="抓包得到的 sign" /></label><label><span>服务地址</span><input value={target} onChange={(event) => setTarget(event.target.value)} /></label></details>{error ? <p className="login-error">{error}</p> : null}<Button className="primary-button login-button" isDisabled={!token.trim() || submitting} onPress={() => onLogin({ tokenText: token, cookie, sign, target })}>{submitting ? "正在验证会话…" : <>进入待处理工单 <Icon name="chevron" size={17} /></>}</Button><p className="login-hint">Cookie 与 sign 只保留在本次应用会话中；退出登录会立即清除。</p></section>;
}
