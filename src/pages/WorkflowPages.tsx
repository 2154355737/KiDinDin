import type { CSSProperties } from "react";
import { m } from "framer-motion";
import type { BatchSubmitMode, WorkOrder } from "../types/workOrder";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/Navigation";
import { StatusBadge } from "../components/WorkOrderList";
import { WorkflowSteps } from "../components/WorkflowSteps";
import {
  FilePreview,
  UploadFilePicker,
  WatermarkedFilePreview,
} from "../components/UploadFilePicker";

type DateProps = { date: string; onDateChange: (value: string) => void };

type HistoryPhotoCandidate = {
  file: File;
  historyLabel: string;
  id: string;
  originalName: string;
  previewUrl: string;
};

type HistoryPhotoStatus = "idle" | "loading" | "ready" | "error";

type WatermarkedOrderPreview = {
  address: string;
  previewFiles: [File, File];
};

type WatermarkPreparationState = {
  debug?: WatermarkDebugStep[];
  message: string;
  status: "pending" | "waiting" | "generating" | "ready" | "error";
};

type WatermarkDebugStep = {
  durationMs: number;
  label: string;
};

export function ModePage({ mode, intervalMinSeconds, intervalMaxSeconds, onModeChange, onIntervalMinChange, onIntervalMaxChange, onBack, onNext }: { mode: BatchSubmitMode; intervalMinSeconds: number; intervalMaxSeconds: number; onModeChange: (value: BatchSubmitMode) => void; onIntervalMinChange: (value: number) => void; onIntervalMaxChange: (value: number) => void; onBack: () => void; onNext: () => void }) {
  const intervalSummary = intervalMinSeconds === intervalMaxSeconds
    ? `${intervalMinSeconds} 秒固定间隔`
    : `${intervalMinSeconds}–${intervalMaxSeconds} 秒随机间隔`;
  const intervalRangeStyle = {
    "--interval-start": `${((intervalMinSeconds - 1) / 19) * 100}%`,
    "--interval-end": `${((intervalMaxSeconds - 1) / 19) * 100}%`,
  } as CSSProperties;

  return <><header className="subheader"><button className="back-button" onClick={onBack} aria-label="返回"><Icon name="chevron" /></button><h1>批量提交设置</h1><div /></header><WorkflowSteps current={1} /><section className="workflow-intro"><p className="eyebrow">步骤 1</p><h2>手动上传与请求间隔</h2><span>当前仅开放手动上传模式；确认页生成水印和正式提交都会按顺序执行，并复用下方间隔。</span></section><section className="mode-options"><button type="button" disabled><b>手动图片提交</b><span>已停用：不再共用批次补图</span><small>已停用</small></button><button type="button" disabled><b>历史到访不遇</b><span>已停用：不再自动拉取历史照片</span><small>已停用</small></button><button type="button" className={mode === "all-manual" ? "active" : ""} onClick={() => onModeChange("all-manual")}><b>手动上传模式</b><span>自动勾选并带入已预填门头照的工单，其余照片按工单逐张选择并校验重复</span></button></section><section className="interval-setting"><div><b>图片生成与工单提交间隔</b><span>避免连续请求过快，生成下一单水印和提交下一单都会随机等待</span></div><div className="interval-slider" aria-label="图片生成与工单提交间隔"><output aria-live="polite">{intervalSummary}</output><div className="interval-dual-range" style={intervalRangeStyle}><input type="range" min="1" max="20" value={intervalMinSeconds} onChange={(event) => onIntervalMinChange(Number(event.target.value))} aria-label="最短请求间隔" /><input type="range" min="1" max="20" value={intervalMaxSeconds} onChange={(event) => onIntervalMaxChange(Number(event.target.value))} aria-label="最长请求间隔" /><span className="interval-range-thumb is-min" aria-hidden="true" /><span className="interval-range-thumb is-max" aria-hidden="true" /></div><div className="interval-scale" aria-hidden="true"><span>1 秒</span><span>20 秒</span></div></div></section><div className="page-action"><button type="button" className="primary-button" onClick={onNext}>下一步：选择工单 <Icon name="chevron" size={17} /></button></div></>;
}

export function PreparePage({ orders, activeOrder, submitMode, historyFile, selectedHistoryPhotoId, historyMode, historyPhotos, historyPhotoError, historyPhotoLoading, historyPhotoStatusByOrder, libraryFile, detailCloseupFile, allManualReadyByOrder, allManualDoorfrontReadyByOrder, storefrontPrefilledByOrder, storefrontPrefillMessage, checkingDuplicates, date, onDateChange, onBack, onSelectOrder, onPickHistoryFile, onHistoryModeChange, onFindHistoricalPhotos, onSelectHistoricalPhoto, onPickLibraryFile, onPickDetailCloseupFile, onNext }: { orders: WorkOrder[]; activeOrder: WorkOrder; submitMode: BatchSubmitMode; historyFile: File | null; selectedHistoryPhotoId: string; historyMode: "manual" | "auto"; historyPhotos: HistoryPhotoCandidate[]; historyPhotoError: string | null; historyPhotoLoading: boolean; historyPhotoStatusByOrder: Record<string, HistoryPhotoStatus>; libraryFile: File | null; detailCloseupFile: File | null; allManualReadyByOrder: Record<string, boolean>; allManualDoorfrontReadyByOrder: Record<string, boolean>; storefrontPrefilledByOrder: Record<string, boolean>; storefrontPrefillMessage: string; checkingDuplicates: boolean; onBack: () => void; onSelectOrder: (id: string) => void; onPickHistoryFile: (file: File | null) => void | Promise<void>; onHistoryModeChange: (mode: "manual" | "auto") => void; onFindHistoricalPhotos: () => void; onSelectHistoricalPhoto: (photo: HistoryPhotoCandidate) => void; onPickLibraryFile: (file: File | null) => void | Promise<void>; onPickDetailCloseupFile: (file: File | null) => void | Promise<void>; onNext: () => void | Promise<void> } & DateProps) {
  const allManual = submitMode === "all-manual";
  const statusLabels: Record<HistoryPhotoStatus, string> = {
    idle: "待拉取",
    loading: "拉取中",
    ready: "已就绪",
    error: "无照片",
  };
  const batchLoadingCount = Object.values(historyPhotoStatusByOrder).filter(
    (status) => status === "loading",
  ).length;

  return <><SubHeader title="选择提交图片" date={date} onDateChange={onDateChange} onBack={onBack} /><WorkflowSteps current={2} />{allManual && storefrontPrefillMessage ? <p className="storefront-prefill-summary" role="status">{storefrontPrefillMessage}</p> : null}<section className="prepare-tabs">{orders.map((order, index) => {
    const status = historyPhotoStatusByOrder[order.id] ?? "idle";
    const statusText = allManual
      ? allManualReadyByOrder[order.id]
        ? storefrontPrefilledByOrder[order.id]
          ? "预填门头 · 两张已就绪"
          : "两张已就绪"
        : storefrontPrefilledByOrder[order.id]
          ? "门头已自动带入"
          : allManualDoorfrontReadyByOrder[order.id]
            ? "门头已选 · 待近景"
            : "待选两张"
      : statusLabels[status];
    return <button key={`${order.id}-${index}`} onClick={() => onSelectOrder(order.id)} className={order.id === activeOrder.id ? "active" : ""}>{order.resident}<small>{order.unit} · {statusText}</small></button>;
  })}</section><section className="prep-order"><p className="eyebrow">{activeOrder.id}</p><h2>{activeOrder.address}</h2><span>{activeOrder.resident} · {activeOrder.unit} · {activeOrder.time}</span></section><section className="section-block"><div className="section-heading"><div><h3>{allManual ? "门头照片" : "历史到访照片"}</h3><p>{allManual ? (storefrontPrefilledByOrder[activeOrder.id] ? "已从工单详情的持久预填自动带入；重新选择时会校验图片内容是否重复" : "请手动选择门头照片；系统会按图片内容自动去重") : "选择一张已核验的“到访不遇”图片"}</p></div><b className={allManual && storefrontPrefilledByOrder[activeOrder.id] ? "is-prefilled" : ""}>{allManual && storefrontPrefilledByOrder[activeOrder.id] ? "详情预填" : "必选"}</b></div>{!allManual && <div className="photo-source-tabs"><button type="button" className={historyMode === "manual" ? "active" : ""} onClick={() => onHistoryModeChange("manual")}>手动上传</button><button type="button" className={historyMode === "auto" ? "active" : ""} onClick={() => onHistoryModeChange("auto")}>自动拉取</button></div>}{allManual || historyMode === "manual" ? <UploadFilePicker file={historyFile} inputKey={`${activeOrder.id}-primary`} label={allManual ? "门头照片" : "历史到访照片"} placeholder={allManual ? "选择当前工单门头照片" : "选择历史照片"} onPick={onPickHistoryFile} /> : <div className="auto-history-source"><p>{batchLoadingCount > 0 ? `正在批量拉取所选工单，剩余 ${batchLoadingCount} 单处理中…` : historyPhotoLoading ? "正在自动核验历史工单与到访不遇日志…" : "所选工单已批量拉取，可直接切换卡片选择照片。"}</p>{historyPhotoError ? <><p className="history-photo-error">{historyPhotoError}</p><button type="button" className="auto-history-search" onClick={onFindHistoricalPhotos}>重新查询</button></> : null}{historyPhotos.length > 0 && <div className="history-photo-grid">{historyPhotos.map((photo) => <button type="button" key={photo.id} className={selectedHistoryPhotoId === photo.id ? "selected" : ""} onClick={() => onSelectHistoricalPhoto(photo)}><img src={photo.previewUrl} alt={photo.originalName} /><span>{photo.originalName}</span><small>历史单 {photo.historyLabel}</small></button>)}</div>}</div>}</section><section className="section-block"><div className="section-heading"><div><h3>{allManual ? "到访不遇详细单近景照片" : "本机图库补图"}</h3><p>{allManual ? "当前工单单独选择；与本批次任一已选照片重复时会立即拦截" : "选择一张现场环境图片"}</p></div><b>必选</b></div><UploadFilePicker file={allManual ? detailCloseupFile : libraryFile} inputKey={`${activeOrder.id}-secondary`} label={allManual ? "到访不遇详细单近景照片" : "本机图库补图"} placeholder={allManual ? "选择当前工单详细单近景照片" : "选择本机补图"} onPick={allManual ? onPickDetailCloseupFile : onPickLibraryFile} /></section><div className="page-action"><button type="button" className="primary-button" disabled={checkingDuplicates} onClick={onNext}>{checkingDuplicates ? "正在校验图片…" : <>下一步：确认提交 <Icon name="chevron" size={17} /></>}</button></div></>;
}

export function ConfirmPage({ orders, submitMode, historyFiles, libraryFile, detailCloseupFiles, watermarkedUploads, watermarkPreparationByOrder, watermarkPreparationRunning, watermarkPreparationMessage, watermarksReady, reason, remark, operatorName, operatorLocked, date, onDateChange, onBack, onReasonChange, onRemarkChange, onOperatorNameChange, onRegenerate, onStart }: { orders: WorkOrder[]; submitMode: BatchSubmitMode; historyFiles: Record<string, File>; libraryFile: File | null; detailCloseupFiles: Record<string, File>; watermarkedUploads: Record<string, WatermarkedOrderPreview>; watermarkPreparationByOrder: Record<string, WatermarkPreparationState>; watermarkPreparationRunning: boolean; watermarkPreparationMessage: string; watermarksReady: boolean; reason: string; remark: string; operatorName: string; operatorLocked: boolean; onBack: () => void; onReasonChange: (value: string) => void; onRemarkChange: (value: string) => void; onOperatorNameChange: (value: string) => void; onRegenerate: () => void; onStart: () => void } & DateProps) {
  const allManual = submitMode === "all-manual";
  const readyCount = orders.filter(
    (order) => watermarkPreparationByOrder[order.id]?.status === "ready",
  ).length;
  const progress = orders.length ? (readyCount / orders.length) * 100 : 0;
  const statusLabels: Record<WatermarkPreparationState["status"], string> = {
    pending: "待生成",
    waiting: "间隔等待",
    generating: "生成中",
    ready: "已生成",
    error: "失败",
  };

  return <><SubHeader title="确认提交" date={date} onDateChange={onDateChange} onBack={onBack} /><WorkflowSteps current={3} /><section className="confirm-hero"><span>本次将串行处理</span><strong>{orders.length}</strong><b>个到访不遇工单</b><p>{watermarksReady ? "每单的两张带水印图片均已生成；确认无误后将复用同一附件组关闭工单，再写入流转日志。" : "正在本页逐单生成带水印图片；相邻工单复用批量设置中的图片间隔时间。"}</p></section><section className="watermark-generation-panel" aria-busy={watermarkPreparationRunning}><div><b>水印预览准备</b><span>{readyCount}/{orders.length}</span></div><p role="status" aria-live="polite" aria-atomic="true">{watermarkPreparationMessage}</p><div className="progress-track" role="progressbar" aria-label="水印预览生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><m.i initial={false} animate={{ width: `${progress}%` }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} /></div>{!watermarkPreparationRunning && !watermarksReady ? <button type="button" className="secondary-button" onClick={onRegenerate}>重新生成未就绪图片</button> : null}</section><section className="confirm-list">{orders.map((order, index) => { const watermarked = watermarkedUploads[order.id]; const preparation = watermarkPreparationByOrder[order.id] ?? { status: "pending", message: "等待生成" }; return <article key={`${order.id}-${index}`}><div><b>{order.resident} · {order.unit}</b><span>{order.id}</span><small className={`watermark-status is-${preparation.status}`}>{statusLabels[preparation.status]} · {preparation.message}</small><small className="watermark-address">水印地址：{watermarked?.address || "生成后显示"}</small></div><div className="mini-photos">{watermarked ? <><WatermarkedFilePreview file={watermarked.previewFiles[0]} label="门头" /><WatermarkedFilePreview file={watermarked.previewFiles[1]} label="详细单近景" /></> : <><FilePreview file={historyFiles[order.id]} label={allManual ? "门头" : "历史"} /><FilePreview file={allManual ? detailCloseupFiles[order.id] : libraryFile} label={allManual ? "详细单近景" : "补图"} /></>}</div></article>; })}</section><section className="form-card"><label>流转人<input value={operatorName} readOnly={operatorLocked} placeholder="请输入流转人" onChange={(event) => onOperatorNameChange(event.target.value)} /></label><label>流转原因<input value={reason} onChange={(event) => onReasonChange(event.target.value)} /></label><label>备注<textarea value={remark} onChange={(event) => onRemarkChange(event.target.value)} placeholder="可选，默认不填写" /></label></section><p className="safety-note">点击每张缩略图可放大确认服务器添加后的水印。提交后不可撤销；关闭成功但日志失败时，系统只会补发日志，不会重复关闭。</p><div className="page-action"><button type="button" className="primary-button" disabled={watermarkPreparationRunning || !watermarksReady} onClick={onStart}>{watermarkPreparationRunning ? "正在逐单生成水印…" : watermarksReady ? <>开始串行提交 <Icon name="play" size={16} /></> : "请先生成全部水印预览"}</button></div></>;
}

export function WatermarkDebugPanel({ orders, watermarkPreparationByOrder }: { orders: WorkOrder[]; watermarkPreparationByOrder: Record<string, WatermarkPreparationState> }) {
  return <section className="watermark-debug-panel" aria-label="水印生成调试输出"><div className="watermark-debug-heading"><b>水印生成调试输出</b><span>耗时单位：毫秒</span></div>{orders.map((order) => { const debug = watermarkPreparationByOrder[order.id]?.debug ?? []; return <article key={`debug-${order.id}`}><strong>{order.woNumber || order.id}</strong>{debug.length ? <ol>{debug.map((step, index) => <li key={`${step.label}-${index}`}><span>{step.label}</span><b>{step.durationMs} ms</b></li>)}</ol> : <p>等待该工单开始处理…</p>}</article>; })}</section>;
}

export function RunningPage({ total, current, message, running, paused, date, onDateChange, onTogglePause, onFinish }: { total: number; current: number; message: string; running: boolean; paused: boolean; onTogglePause: () => void; onFinish: () => void } & DateProps) {
  const safeTotal = Math.max(total, 1);
  const progress = Math.max(0, Math.min(100, (current / safeTotal) * 100));
  return <><SubHeader title="正在提交" date={date} onDateChange={onDateChange} /><WorkflowSteps current={4} /><div className="run-status"><div className="run-ring" style={{ "--run-progress": `${progress * 3.6}deg` } as CSSProperties}><div className="run-ring-content"><b>{current}</b><span>/{total}</span></div></div><h2>{running ? `正在处理第 ${current} 单` : "任务已结束"}</h2><p role="status" aria-live="polite" aria-atomic="true">{message}</p><div className="progress-track" role="progressbar" aria-label="工单提交进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><m.i initial={false} animate={{ width: `${progress}%` }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} /></div></div><section className="run-current"><div className="run-label">执行顺序 <StatusBadge status={running ? "待提交" : "已结束"} /></div><b>复用已确认水印附件 → 关闭安检工单 → 写入流转日志</b><span>关闭成功但日志失败的工单可在记录页单独补发。</span><ol><li className="done">每单的带水印附件已在确认页分别生成</li><li className={running && !paused ? "working" : ""}>当前接口请求中</li><li>关闭安检工单</li><li>写入到访不遇日志</li></ol></section><section className="log-panel"><div>任务状态 <span>实时</span></div><p>{message}</p><p className="muted">所有工单按顺序串行执行，避免重复关闭。</p></section><div className="run-actions">{running ? <button type="button" className="secondary-button" onClick={onTogglePause} disabled>{paused ? <><Icon name="play" size={16} />暂停功能准备中</> : <><Icon name="pause" size={16} />串行提交中</>}</button> : <button type="button" className="primary-button" onClick={onFinish}>下一步：补发流转日志</button>}</div></>;
}

export function RecordsPage({ orders, date, onDateChange, onBack, onRetry }: { orders: WorkOrder[]; onBack: () => void; onRetry: (id: string) => void } & DateProps) {
  const closed = orders.filter((order) => order.status === "已结束").length;
  const logFailed = orders.filter((order) => order.status === "日志失败").length;
  return <><SubHeader title="补发流转日志" date={date} onDateChange={onDateChange} onBack={onBack} /><WorkflowSteps current={5} /><section className="record-summary"><div><b>{closed}</b><span>成功关闭并已写日志</span></div><div><b className="warning-text">{logFailed}</b><span>待补发日志</span></div><div><b>{closed + logFailed}</b><span>本次处理</span></div></section><p className="record-verification-tip">每单均已查询“到访不遇”流转日志；查询不到的关闭工单会自动进入待补发。</p><h2 className="section-title">待补发流转日志</h2><section className="record-list">{orders.filter((order) => order.status === "日志失败").map((order, index) => <article key={`${order.id}-${index}`}><div><b>{order.resident} · {order.unit}</b><span>{order.id} · 今天 {order.time.slice(0, 5)}</span></div><button className="retry-button" onClick={() => onRetry(order.id)}>手动补发日志</button></article>)}{logFailed === 0 && <p className="empty-hint">本次所有已关闭工单均已核验流转日志。</p>}</section></>;
}
