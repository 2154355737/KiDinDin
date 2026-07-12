import { useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "../components/Icon";

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState("");
  return <section className="login-screen"><div className="login-mark"><span><Icon name="check" size={26} /></span></div><p className="eyebrow">KiDinDin · 原生会话</p><h1>到访不遇批量处理</h1><p className="login-copy">粘贴抓取到的登录响应 JSON 或 Bearer token。仅保存于本机，退出时立即清除。</p><label className="token-field"><span>登录凭据</span><textarea value={token} onChange={(event) => setToken(event.target.value)} placeholder={'Bearer eyJ...\n或粘贴完整登录响应 JSON'} /></label><Button className="primary-button login-button" isDisabled={!token.trim()} onPress={onLogin}>进入待处理工单 <Icon name="chevron" size={17} /></Button><p className="login-hint">演示界面：输入任意内容即可进入。真实版本将由原生侧解析并替换 Authorization。</p></section>;
}
