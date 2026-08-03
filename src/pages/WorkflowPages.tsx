import { useEffect, useState, type CSSProperties } from "react";
import { m } from "framer-motion";
import type { WorkOrder } from "../types/workOrder";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/Navigation";
import { StatusBadge } from "../components/WorkOrderList";
import { WorkflowSteps } from "../components/WorkflowSteps";

type DateProps = { date: string; onDateChange: (value: string) => void };

type HistoryPhotoCandidate = {
  file: File;
  historyLabel: string;
  id: string;
  originalName: string;
  previewUrl: string;
};

type HistoryPhotoStatus = "idle" | "loading" | "ready" | "error";

export function ModePage({ mode, intervalMinSeconds, intervalMaxSeconds, onModeChange, onIntervalMinChange, onIntervalMaxChange, onBack, onNext }: { mode: "manual" | "historical"; intervalMinSeconds: number; intervalMaxSeconds: number; onModeChange: (value: "manual" | "historical") => void; onIntervalMinChange: (value: number) => void; onIntervalMaxChange: (value: number) => void; onBack: () => void; onNext: () => void }) {
  return <><header className="subheader"><button className="back-button" onClick={onBack} aria-label="返回"><Icon name="chevron" /></button><h1>批量提交设置</h1><div /></header><WorkflowSteps current={1} /><section className="workflow-intro"><p className="eyebrow">步骤 1</p><h2>选择提交模式与间隔</h2><span>工单将按顺序执行，间隔只在相邻两单之间生效。</span></section><section className="mode-options"><button type="button" className={mode === "manual" ? "active" : ""} onClick={() => onModeChange("manual")}><b>手动图片提交</b><span>手动上传或选择历史到访照片</span></button><button type="button" className={mode === "historical" ? "active" : ""} onClick={() => onModeChange("historical")}><b>历史到访不遇</b><span>自动核验历史工单，再手动选择命中照片</span></button></section><section className="interval-setting"><div><b>工单提交间隔</b><span>避免连续请求过快，下一单会随机等待</span></div><label><input type="number" min="0" max="300" value={intervalMinSeconds} onChange={(event) => onIntervalMinChange(Math.max(0, Math.min(300, Number(event.target.value) || 0)))} /><i>–</i><input type="number" min="0" max="300" value={intervalMaxSeconds} onChange={(event) => onIntervalMaxChange(Math.max(0, Math.min(300, Number(event.target.value) || 0)))} /><em>秒</em></label></section><div className="page-action"><button type="button" className="primary-button" onClick={onNext}>下一步：选择工单 <Icon name="chevron" size={17} /></button></div></>;
}

export function PreparePage({ orders, activeOrder, historyFileName, selectedHistoryPhotoId, historyMode, historyPhotos, historyPhotoError, historyPhotoLoading, historyPhotoStatusByOrder, libraryFileName, date, onDateChange, onBack, onSelectOrder, onPickHistoryFile, onHistoryModeChange, onFindHistoricalPhotos, onSelectHistoricalPhoto, onPickLibraryFile, onNext }: { orders: WorkOrder[]; activeOrder: WorkOrder; historyFileName: string; selectedHistoryPhotoId: string; historyMode: "manual" | "auto"; historyPhotos: HistoryPhotoCandidate[]; historyPhotoError: string | null; historyPhotoLoading: boolean; historyPhotoStatusByOrder: Record<string, HistoryPhotoStatus>; libraryFileName: string; onBack: () => void; onSelectOrder: (id: string) => void; onPickHistoryFile: (file: File | null) => void; onHistoryModeChange: (mode: "manual" | "auto") => void; onFindHistoricalPhotos: () => void; onSelectHistoricalPhoto: (photo: HistoryPhotoCandidate) => void; onPickLibraryFile: (file: File | null) => void; onNext: () => void } & DateProps) {
  const statusLabels: Record<HistoryPhotoStatus, string> = {
    idle: "待拉取",
    loading: "拉取中",
    ready: "已就绪",
    error: "无照片",
  };
  const batchLoadingCount = Object.values(historyPhotoStatusByOrder).filter(
    (status) => status === "loading",
  ).length;

  return <><SubHeader title="选择提交图片" date={date} onDateChange={onDateChange} onBack={onBack} /><WorkflowSteps current={2} /><section className="prepare-tabs">{orders.map((order, index) => {
    const status = historyPhotoStatusByOrder[order.id] ?? "idle";
    return <button key={`${order.id}-${index}`} onClick={() => onSelectOrder(order.id)} className={order.id === activeOrder.id ? "active" : ""}>{order.resident}<small>{order.unit} · {statusLabels[status]}</small></button>;
  })}</section><section className="prep-order"><p className="eyebrow">{activeOrder.id}</p><h2>{activeOrder.address}</h2><span>{activeOrder.resident} · {activeOrder.unit} · {activeOrder.time}</span></section><section className="section-block"><div className="section-heading"><div><h3>历史到访照片</h3><p>选择一张已核验的“到访不遇”图片</p></div><b>必选</b></div><div className="photo-source-tabs"><button type="button" className={historyMode === "manual" ? "active" : ""} onClick={() => onHistoryModeChange("manual")}>手动上传</button><button type="button" className={historyMode === "auto" ? "active" : ""} onClick={() => onHistoryModeChange("auto")}>自动拉取</button></div>{historyMode === "manual" ? <label className="file-picker"><span>{historyFileName || "选择历史照片"}</span><input type="file" accept="image/*" onChange={(event) => onPickHistoryFile(event.target.files?.[0] ?? null)} /></label> : <div className="auto-history-source"><p>{batchLoadingCount > 0 ? `正在批量拉取所选工单，剩余 ${batchLoadingCount} 单处理中…` : historyPhotoLoading ? "正在自动核验历史工单与到访不遇日志…" : "所选工单已批量拉取，可直接切换卡片选择照片。"}</p>{historyPhotoError ? <><p className="history-photo-error">{historyPhotoError}</p><button type="button" className="auto-history-search" onClick={onFindHistoricalPhotos}>重新查询</button></> : null}{historyPhotos.length > 0 && <div className="history-photo-grid">{historyPhotos.map((photo) => <button type="button" key={photo.id} className={selectedHistoryPhotoId === photo.id ? "selected" : ""} onClick={() => onSelectHistoricalPhoto(photo)}><img src={photo.previewUrl} alt={photo.originalName} /><span>{photo.originalName}</span><small>历史单 {photo.historyLabel}</small></button>)}</div>}</div>}</section><section className="section-block"><div className="section-heading"><div><h3>本机图库补图</h3><p>选择一张现场环境图片</p></div><b>必选</b></div><label className="file-picker"><span>{libraryFileName || "选择本机补图"}</span><input type="file" accept="image/*" onChange={(event) => onPickLibraryFile(event.target.files?.[0] ?? null)} /></label></section><div className="page-action"><button type="button" className="primary-button" onClick={onNext}>下一步：确认提交 <Icon name="chevron" size={17} /></button></div></>;
}

function FilePreview({ file, label }: { file: File | null | undefined; label: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) { setUrl(""); return; }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return <div className="file-preview">{url ? <img src={url} alt={label} /> : <span>未选择</span>}<small>{label}</small></div>;
}

export function ConfirmPage({ orders, historyFiles, libraryFile, reason, remark, operatorName, operatorLocked, date, onDateChange, onBack, onReasonChange, onRemarkChange, onOperatorNameChange, onStart }: { orders: WorkOrder[]; historyFiles: Record<string, File>; libraryFile: File | null; reason: string; remark: string; operatorName: string; operatorLocked: boolean; onBack: () => void; onReasonChange: (value: string) => void; onRemarkChange: (value: string) => void; onOperatorNameChange: (value: string) => void; onStart: () => void } & DateProps) {
  return <><SubHeader title="确认提交" date={date} onDateChange={onDateChange} onBack={onBack} /><WorkflowSteps current={3} /><section className="confirm-hero"><span>本次将串行处理</span><strong>{orders.length}</strong><b>个到访不遇工单</b><p>每单上传两张照片后关闭工单，再写入流转日志。</p></section><section className="confirm-list">{orders.map((order, index) => <article key={`${order.id}-${index}`}><div><b>{order.resident} · {order.unit}</b><span>{order.id}</span></div><div className="mini-photos"><FilePreview file={historyFiles[order.id]} label="历史" /><FilePreview file={libraryFile} label="补图" /></div></article>)}</section><section className="form-card"><label>流转人<input value={operatorName} readOnly={operatorLocked} placeholder="请输入流转人" onChange={(event) => onOperatorNameChange(event.target.value)} /></label><label>流转原因<input value={reason} onChange={(event) => onReasonChange(event.target.value)} /></label><label>备注<textarea value={remark} onChange={(event) => onRemarkChange(event.target.value)} placeholder="可选，默认不填写" /></label></section><p className="safety-note">提交后不可撤销。关闭成功但日志失败时，系统只会补发日志，不会重复关闭。</p><div className="page-action"><button type="button" className="primary-button" onClick={onStart}>开始串行提交 <Icon name="play" size={16} /></button></div></>;
}

export function RunningPage({ total, current, message, running, paused, date, onDateChange, onTogglePause, onFinish }: { total: number; current: number; message: string; running: boolean; paused: boolean; onTogglePause: () => void; onFinish: () => void } & DateProps) {
  const safeTotal = Math.max(total, 1);
  const progress = Math.max(0, Math.min(100, (current / safeTotal) * 100));
  return <><SubHeader title="正在提交" date={date} onDateChange={onDateChange} /><WorkflowSteps current={4} /><div className="run-status"><div className="run-ring" style={{ "--run-progress": `${progress * 3.6}deg` } as CSSProperties}><div className="run-ring-content"><b>{current}</b><span>/{total}</span></div></div><h2>{running ? `正在处理第 ${current} 单` : "任务已结束"}</h2><p role="status" aria-live="polite" aria-atomic="true">{message}</p><div className="progress-track" role="progressbar" aria-label="工单提交进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><m.i initial={false} animate={{ width: `${progress}%` }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} /></div></div><section className="run-current"><div className="run-label">执行顺序 <StatusBadge status={running ? "待提交" : "已结束"} /></div><b>上传两张图片 → 关闭安检工单 → 写入流转日志</b><span>关闭成功但日志失败的工单可在记录页单独补发。</span><ol><li className="done">图片已由安卓原生层编码并上传</li><li className={running && !paused ? "working" : ""}>当前接口请求中</li><li>关闭安检工单</li><li>写入到访不遇日志</li></ol></section><section className="log-panel"><div>任务状态 <span>实时</span></div><p>{message}</p><p className="muted">所有工单按顺序串行执行，避免重复关闭。</p></section><div className="run-actions">{running ? <button type="button" className="secondary-button" onClick={onTogglePause} disabled>{paused ? <><Icon name="play" size={16} />暂停功能准备中</> : <><Icon name="pause" size={16} />串行提交中</>}</button> : <button type="button" className="primary-button" onClick={onFinish}>下一步：补发流转日志</button>}</div></>;
}

export function RecordsPage({ orders, date, onDateChange, onBack, onRetry }: { orders: WorkOrder[]; onBack: () => void; onRetry: (id: string) => void } & DateProps) {
  const closed = orders.filter((order) => order.status === "已结束").length;
  const logFailed = orders.filter((order) => order.status === "日志失败").length;
  return <><SubHeader title="补发流转日志" date={date} onDateChange={onDateChange} onBack={onBack} /><WorkflowSteps current={5} /><section className="record-summary"><div><b>{closed}</b><span>成功关闭并已写日志</span></div><div><b className="warning-text">{logFailed}</b><span>待补发日志</span></div><div><b>{closed + logFailed}</b><span>本次处理</span></div></section><p className="record-verification-tip">每单均已查询“到访不遇”流转日志；查询不到的关闭工单会自动进入待补发。</p><h2 className="section-title">待补发流转日志</h2><section className="record-list">{orders.filter((order) => order.status === "日志失败").map((order, index) => <article key={`${order.id}-${index}`}><div><b>{order.resident} · {order.unit}</b><span>{order.id} · 今天 {order.time.slice(0, 5)}</span></div><button className="retry-button" onClick={() => onRetry(order.id)}>手动补发日志</button></article>)}{logFailed === 0 && <p className="empty-hint">本次所有已关闭工单均已核验流转日志。</p>}</section></>;
}
