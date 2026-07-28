import { useState } from "react";
import { Icon } from "../components/Icon";
import type { AuthHistoryItem } from "../services/authApi";

export function LoginPage({ onLogin, history, error, submitting, onRestoreHistory }: {
  onLogin: (input: { tokenText: string; cookie: string; sign: string; target: string }) => void;
  history: AuthHistoryItem[];
  error?: string | null;
  submitting?: boolean;
  onRestoreHistory: (id: string) => void;
}) {
  const [token, setToken] = useState("");
  const [cookie, setCookie] = useState("");
  const [sign, setSign] = useState("");
  const [target, setTarget] = useState("https://cis.whng.com.cn");
  return <section className="login-screen"><div className="login-mark"><span><Icon name="check" size={26} /></span></div><p className="eyebrow">KiDinDin · 原生会话</p><h1>到访不遇批量处理</h1><p className="login-copy">粘贴登录响应 JSON 或 Bearer token。请求由安卓原生层发出，令牌不会写入网页存储。</p>{history.length > 0 && <section className="login-history"><div className="login-history-heading"><span>历史登录</span><small>点击恢复本机已保存凭据</small></div><div className="login-history-list">{history.map((item) => <button type="button" key={item.id} className="history-login-item" disabled={submitting} onClick={() => onRestoreHistory(item.id)}><span className="history-avatar">{(item.username ?? item.employeeNumber ?? "凭").slice(0, 1)}</span><span className="history-login-copy"><b>{item.username ?? "已保存凭据"}</b><small>{item.employeeNumber ? `工号 ${item.employeeNumber}` : "未识别账号"} · {item.tokenHint}</small></span><Icon name="chevron" size={17} /></button>)}</div></section>}<label className="token-field"><span>登录凭据</span><textarea value={token} onChange={(event) => setToken(event.target.value)} placeholder={'Bearer eyJ...\n或粘贴包含 access_token 的登录响应 JSON'} /></label><details className="login-extra"><summary>请求附加信息（Cookie / sign）</summary><label><span>Cookie（可选）</span><input value={cookie} onChange={(event) => setCookie(event.target.value)} placeholder="JSESSIONID=..." /></label><label><span>sign（接口要求时填写）</span><input value={sign} onChange={(event) => setSign(event.target.value)} placeholder="抓包得到的 sign" /></label><label><span>服务地址</span><input value={target} onChange={(event) => setTarget(event.target.value)} /></label></details>{error ? <p className="login-error">{error}</p> : null}<button type="button" className="primary-button login-button" disabled={!token.trim() || submitting} onClick={() => onLogin({ tokenText: token, cookie, sign, target })}>{submitting ? "正在验证会话…" : <>进入待处理工单 <Icon name="chevron" size={17} /></>}</button><p className="login-hint">凭据仅保存于本机原生应用；历史记录只展示掩码 Token，退出登录不会删除历史记录。</p></section>;
}
