import { useEffect, useState } from "react";
import { Alert, Button, Input, Space, Switch } from "antd";
import type { useNoticeCodeDeduplication } from "../hooks/useNoticeCodeDeduplication";

type Controller = ReturnType<typeof useNoticeCodeDeduplication>;

export function NoticeCodePanel({ enabled, onEnabledChange, controller, orderId, summary = false }: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  controller: Controller;
  orderId?: string;
  summary?: boolean;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const entry = orderId ? controller.entries[orderId] : undefined;
  const conflict = orderId ? controller.conflictFor(orderId) : null;
  useEffect(() => { setCode(entry?.code ?? ""); setError(""); }, [orderId, entry?.code, entry?.file]);
  const touch = { minHeight: 44 };
  return <section className="section-block">
    <div className="section-heading">
      <div><h3>通知单编码去重</h3><p>本地条码与文字识别；关闭立即跳过编码校验，保留图片内容去重。</p></div>
      <span style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}><Switch checked={enabled} onChange={onEnabledChange} aria-label="通知单编码去重" /></span>
    </div>
    {enabled && entry && <Space orientation="vertical" style={{ width: "100%" }}>
      <p role="status" aria-live="polite">{entry.message}{entry.confirmed ? ` · ${entry.code}` : ""}</p>
      {conflict && <Alert type="error" title={`编码 ${entry.code} 已用于 ${conflict.label}，请核对或更换照片`} />}
      <Input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" maxLength={40} aria-label="通知单印刷编码" placeholder="核对照片上的印刷编码，可保留前导 0" style={touch} />
      <Space wrap>
        <Button style={touch} onClick={() => { try { controller.confirm(orderId!, code); setError(""); } catch (reason) { setError(String(reason)); } }}>确认编码</Button>
        <Button style={touch} disabled={entry.loading} onClick={() => controller.retry(orderId!)}>重新识别</Button>
        <Button style={touch} onClick={() => controller.skip(orderId!)}>跳过本张编码校验</Button>
      </Space>
      {!entry.confirmed && <p>本张尚无已确认编码，继续提交时可能无法发现同一通知单的不同照片。</p>}
    </Space>}
    {summary && enabled && <p role="status">已确认 {Object.values(controller.entries).filter((value) => value.confirmed).length} 张通知单编码；未识别或未确认的照片仅按图片内容去重。</p>}
    {controller.warning && <Alert type="warning" title={controller.warning} />}
    {error && <Alert type="error" title={error} />}
  </section>;
}
