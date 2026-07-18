import { DatePicker } from "../components/DatePicker";
import { Icon } from "../components/Icon";
import { useState } from "react";
import type { WorkOrder } from "../types/workOrder";

export type LogAuditState = "checking" | "present" | "missing" | "error";
export type LogAuditResult = { state: LogAuditState; message?: string };

type LogAuditPageProps = {
  orders: WorkOrder[];
  date: string;
  results: Record<string, LogAuditResult>;
  auditing: boolean;
  retrying: boolean;
  message: string;
  onDateChange: (value: string) => void;
  onBack: () => void;
  onStartAudit: () => void;
  onBatchRetry: (minSeconds: number, maxSeconds: number) => void;
};

function resultLabel(result?: LogAuditResult) {
  if (!result) return "未审核";
  if (result.state === "checking") return "查询中";
  if (result.state === "present") return "日志正常";
  if (result.state === "missing") return "缺少日志";
  return "查询失败";
}

export function LogAuditPage({ orders, date, results, auditing, retrying, message, onDateChange, onBack, onStartAudit, onBatchRetry }: LogAuditPageProps) {
  const [intervalMinSeconds, setIntervalMinSeconds] = useState(5);
  const [intervalMaxSeconds, setIntervalMaxSeconds] = useState(10);
  const [retryConfirmOpen, setRetryConfirmOpen] = useState(false);
  const endedOrders = orders.filter((order) => order.backendStatusCode === "60");
  const resultList = Object.values(results);
  const present = resultList.filter((item) => item.state === "present").length;
  const missing = resultList.filter((item) => item.state === "missing").length;
  const errors = resultList.filter((item) => item.state === "error").length;
  const canBatchRetry = missing > 0 && !auditing && !retrying;
  const updateIntervalMin = (value: number) => {
    const next = Math.max(0, Math.min(300, value || 0));
    setIntervalMinSeconds(next);
    setIntervalMaxSeconds((current) => Math.max(current, next));
  };
  const updateIntervalMax = (value: number) => {
    const next = Math.max(0, Math.min(300, value || 0));
    setIntervalMaxSeconds(next);
    setIntervalMinSeconds((current) => Math.min(current, next));
  };

  return <>
    <header className="subheader audit-subheader">
      <button type="button" className="back-button" onClick={onBack} aria-label="返回"><Icon name="chevron" /></button>
      <h1>流转审核</h1>
      <DatePicker value={date} onChange={onDateChange} />
    </header>

    <section className={`audit-overview ${missing > 0 ? "has-retry" : ""}`}>
      <div className="audit-hero">
        <span>已结束工单</span><strong>{endedOrders.length}</strong><b>单待核验</b>
      </div>
      <section className="audit-summary" aria-label="审核结果汇总">
        <div><b>{present}</b><span>日志正常</span></div>
        <div><b className={missing ? "warning-text" : ""}>{missing}</b><span>缺少日志</span></div>
        <div><b className={errors ? "warning-text" : ""}>{errors}</b><span>查询失败</span></div>
      </section>
      <div className={`audit-action-row ${missing > 0 ? "has-retry" : ""}`}>
        <button type="button" className="audit-start-button" disabled={auditing || retrying || endedOrders.length === 0} onClick={onStartAudit}>
          <Icon name="audit" size={18} />{auditing ? "审核中…" : "审核"}
        </button>
        {missing > 0 && <button type="button" className="audit-retry-button" disabled={!canBatchRetry} onClick={() => setRetryConfirmOpen(true)}><Icon name="send" size={17} />{retrying ? "补发中…" : `补发 ${missing}`}</button>}
      </div>
      {message ? <p className="audit-message" role="status" aria-live="polite">{message}</p> : null}
      {missing > 0 && <section className="audit-retry-panel">
        <label className="audit-interval"><span>补发间隔</span><input type="number" min="0" max="300" value={intervalMinSeconds} disabled={retrying} onChange={(event) => updateIntervalMin(Number(event.target.value))} /><i>–</i><input type="number" min="0" max="300" value={intervalMaxSeconds} disabled={retrying} onChange={(event) => updateIntervalMax(Number(event.target.value))} /><em>秒（随机）</em></label>
      </section>}
    </section>

    <h2 className="section-title">审核明细 <small>{endedOrders.length}</small></h2>
    <section className="record-list audit-record-list">
      {endedOrders.map((order) => {
        const result = results[order.id];
        return <article key={order.id}>
          <div><b>{order.resident} · {order.unit}</b><span>{order.woNumber} · {order.time}</span>{result?.message ? <small>{result.message}</small> : null}</div>
          <i className={`audit-status ${result?.state ?? "idle"}`}>{resultLabel(result)}</i>
        </article>;
      })}
      {!endedOrders.length ? <p className="empty-hint">该日期没有已结束的工单可审核</p> : null}
    </section>
    {retryConfirmOpen && <div className="audit-retry-confirm-backdrop" onClick={() => setRetryConfirmOpen(false)}><section className="audit-retry-confirm-dialog" role="dialog" aria-modal="true" aria-label="确认批量补发流转日志" onClick={(event) => event.stopPropagation()}><h3>补发 {missing} 条日志？</h3><div><button type="button" onClick={() => setRetryConfirmOpen(false)}>取消</button><button type="button" onClick={() => { setRetryConfirmOpen(false); onBatchRetry(intervalMinSeconds, intervalMaxSeconds); }}>确认补发</button></div></section></div>}
  </>;
}
