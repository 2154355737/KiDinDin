import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/Navigation";
import {
  inspectResidentSecurityPrefill,
  saveResidentSecurityPrefill,
  isResidentSecurityPrefillTarget,
  type BatchPrefillResult,
} from "../services/residentSecurityPrefillApi";
import { addResidentSecurityPrefilledId } from "../services/residentSecurityPrefillStore";
import type { WorkOrder } from "../types/workOrder";

type BatchPrefillStatus = "idle" | "inspecting" | "ready" | "saving" | "completed" | "error" | "paused";

type BatchPrefillState = {
  completedCount: number;
  currentIndex: number;
  errorCount: number;
  message: string;
  results: BatchPrefillResult[];
  skippedCount: number;
  status: BatchPrefillStatus;
  totalCount: number;
};

export type DailyBatchPrefillPageProps = {
  accountKey: string;
  date: string;
  onBack: () => void;
  onDateChange: (value: string) => void;
  onPrefilledIdsChange?: (woHeaderIds: string[]) => void;
  orders: WorkOrder[];
};

function statusLabel(status: BatchPrefillStatus) {
  switch (status) {
    case "inspecting":
      return "检查中";
    case "ready":
      return "待预存";
    case "saving":
      return "预存中";
    case "completed":
      return "已完成";
    case "paused":
      return "已暂停";
    case "error":
      return "执行失败";
    default:
      return "待检查";
  }
}

export function DailyBatchPrefillPage({
  accountKey,
  date,
  onBack,
  onDateChange,
  onPrefilledIdsChange,
  orders,
}: DailyBatchPrefillPageProps) {
  const residentOrders = useMemo(
    () => orders.filter(isResidentSecurityPrefillTarget),
    [orders],
  );

  const [state, setState] = useState<BatchPrefillState>({
    completedCount: 0,
    currentIndex: 0,
    errorCount: 0,
    message: "",
    results: [],
    skippedCount: 0,
    status: "idle",
    totalCount: 0,
  });

  const [message, setMessage] = useState("");
  const pausedRef = useRef(false);
  const busy = state.status === "inspecting" || state.status === "saving";

  useEffect(() => {
    setState({
      completedCount: 0,
      currentIndex: 0,
      errorCount: 0,
      message: "",
      results: [],
      skippedCount: 0,
      status: "idle",
      totalCount: 0,
    });
    setMessage("");
    pausedRef.current = false;
  }, [date]);

  const startBatchPrefill = async () => {
    if (busy || !residentOrders.length) return;

    pausedRef.current = false;
    const results: BatchPrefillResult[] = [];
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    setState({
      completedCount: 0,
      currentIndex: 0,
      errorCount: 0,
      message: "正在批量检查并预填所有居民安检工单...",
      results: [],
      skippedCount: 0,
      status: "inspecting",
      totalCount: residentOrders.length,
    });
    setMessage("自动检查每个工单，如果可预填则立即预存");

    try {
      for (let i = 0; i < residentOrders.length; i++) {
        if (pausedRef.current) {
          setState((prev) => ({
            ...prev,
            completedCount: successCount,
            errorCount,
            message: `已暂停，已处理 ${i} / ${residentOrders.length} 个工单`,
            results,
            skippedCount,
            status: "paused",
          }));
          setMessage("操作已暂停，可继续或重新开始");
          return;
        }

        const order = residentOrders[i];
        setState((prev) => ({
          ...prev,
          currentIndex: i + 1,
          message: `正在检查 ${order.woNumber || order.woHeaderId} (${i + 1}/${residentOrders.length})`,
        }));

        try {
          // 第一步：检查工单
          const preview = await inspectResidentSecurityPrefill(order);

          if (preview.prefillCount > 0) {
            // 第二步：如果可预填，立即预存
            setState((prev) => ({
              ...prev,
              message: `正在预存 ${order.woNumber || order.woHeaderId} (${i + 1}/${residentOrders.length})`,
              status: "saving",
            }));

            const saved = await saveResidentSecurityPrefill(
              order,
              preview.historyWoHeaderId,
            );

            results.push({
              error: null,
              historyWoHeaderId: preview.historyWoHeaderId,
              historyWoNumber: preview.historyWoNumber,
              historyYear: preview.historyYear,
              prefillCount: saved.prefillCount,
              saved: saved.prefillCount > 0,
              unit: order.unit,
              woHeaderId: order.woHeaderId,
              woNumber: order.woNumber,
            });

            if (saved.prefillCount > 0) {
              successCount++;
              // 记录已预填的工单
              addResidentSecurityPrefilledId(accountKey, order.woHeaderId);
              if (onPrefilledIdsChange) {
                onPrefilledIdsChange([order.woHeaderId]);
              }
            } else {
              skippedCount++;
            }
          } else {
            // 无需预填的工单
            results.push({
              error: null,
              historyWoHeaderId: preview.historyWoHeaderId,
              historyWoNumber: preview.historyWoNumber,
              historyYear: preview.historyYear,
              prefillCount: 0,
              saved: false,
              unit: order.unit,
              woHeaderId: order.woHeaderId,
              woNumber: order.woNumber,
            });
            skippedCount++;
          }

          setState((prev) => ({
            ...prev,
            completedCount: successCount,
            errorCount,
            results: [...results],
            skippedCount,
            status: "inspecting",
          }));
        } catch (error) {
          results.push({
            error: error instanceof Error ? error.message : "处理失败",
            historyWoHeaderId: "",
            historyWoNumber: "",
            historyYear: 0,
            prefillCount: 0,
            saved: false,
            unit: order.unit,
            woHeaderId: order.woHeaderId,
            woNumber: order.woNumber,
          });
          errorCount++;

          setState((prev) => ({
            ...prev,
            completedCount: successCount,
            errorCount,
            results: [...results],
            skippedCount,
          }));
        }
      }

      setState({
        completedCount: successCount,
        currentIndex: residentOrders.length,
        errorCount,
        message: `批量预填完成：${successCount} 个成功，${skippedCount} 个跳过，${errorCount} 个失败`,
        results,
        skippedCount,
        status: "completed",
        totalCount: residentOrders.length,
      });
      setMessage(
        successCount > 0
          ? `成功预填 ${successCount} 个工单`
          : "预填完成，但没有工单被写入",
      );
    } catch (error) {
      setState((prev) => ({
        ...prev,
        message: error instanceof Error ? error.message : "批量预填失败",
        status: "error",
      }));
      setMessage("批量预填失败");
    }
  };

  const pauseOperation = () => {
    if (state.status === "inspecting" || state.status === "saving") {
      pausedRef.current = true;
    }
  };

  const continueOperation = () => {
    if (state.status === "paused") {
      void startBatchPrefill();
    }
  };

  const successResults = state.results.filter((r) => r.saved);
  const skippedResults = state.results.filter(
    (r) => !r.saved && r.error === null && r.prefillCount === 0,
  );
  const errorResults = state.results.filter((r) => r.error !== null);

  return (
    <>
      <SubHeader
        title="当天工单一键预填"
        date={date}
        onDateChange={(value) => {
          if (!busy) onDateChange(value);
        }}
        onBack={onBack}
      />

      <section className="vacant-room-hero vacant-fill-hero resident-prefill-hero">
        <div>
          <span>批量预填模式</span>
          <strong>{residentOrders.length}</strong>
          <b>个待处理居民安检</b>
        </div>
        <p>
          一键检查并预存当天所有居民安检工单的上一年度历史数据，自动跳过已存在内容的工单。
        </p>
      </section>

      <section className="vacant-fill-status">
        <div className="vacant-fill-status-card">
          <div className="vacant-fill-status-header">
            <span>
              <Icon name="tasks" size={17} />
              <b>执行状态</b>
            </span>
            <em className={`batch-status-${state.status}`}>{statusLabel(state.status)}</em>
          </div>
          {state.message ? (
            <p className="vacant-fill-status-message">{state.message}</p>
          ) : null}
          {state.totalCount > 0 ? (
            <div className="vacant-fill-progress">
              <div className="vacant-fill-progress-bar">
                <div
                  className="vacant-fill-progress-fill"
                  style={{
                    width: `${(state.currentIndex / state.totalCount) * 100}%`,
                  }}
                />
              </div>
              <div className="vacant-fill-progress-stats">
                <span>
                  进度 <b>{state.currentIndex}/{state.totalCount}</b>
                </span>
                {state.completedCount > 0 ? (
                  <span className="stat-success">
                    成功 <b>{state.completedCount}</b>
                  </span>
                ) : null}
                {state.skippedCount > 0 ? (
                  <span className="stat-skip">
                    跳过 <b>{state.skippedCount}</b>
                  </span>
                ) : null}
                {state.errorCount > 0 ? (
                  <span className="stat-error">
                    失败 <b>{state.errorCount}</b>
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {!residentOrders.length ? (
        <section className="vacant-room-empty">
          <Icon name="note" size={24} />
          <b>当天没有待处理的居民安检工单</b>
          <span>仅识别待处理且类型为安检 / 居民安检的非空房工单。</span>
        </section>
      ) : null}

      {successResults.length > 0 ? (
        <section className="vacant-fill-results">
          <header>
            <span>
              <Icon name="check" size={15} />
              <b>预存成功</b>
            </span>
            <small>{successResults.length} 单</small>
          </header>
          <div className="vacant-fill-result-list">
            {successResults.map((result) => (
              <article key={result.woHeaderId} className="vacant-fill-result-card success">
                <div className="vacant-fill-result-header">
                  <b>{result.unit}</b>
                  <span>{result.woNumber || result.woHeaderId}</span>
                </div>
                <p className="vacant-fill-result-detail">
                  来源 {result.historyYear} 年 {result.historyWoNumber}，已预填{" "}
                  {result.prefillCount} 项
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {skippedResults.length > 0 ? (
        <section className="vacant-fill-results">
          <header>
            <span>
              <Icon name="minus" size={15} />
              <b>无需预填</b>
            </span>
            <small>{skippedResults.length} 单</small>
          </header>
          <div className="vacant-fill-result-list">
            {skippedResults.map((result) => (
              <article key={result.woHeaderId} className="vacant-fill-result-card skipped">
                <div className="vacant-fill-result-header">
                  <b>{result.unit}</b>
                  <span>{result.woNumber || result.woHeaderId}</span>
                </div>
                <p className="vacant-fill-result-detail">
                  {result.historyYear} 年历史内容已存在于今年工单
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {errorResults.length > 0 ? (
        <section className="vacant-fill-results">
          <header>
            <span>
              <Icon name="alert" size={15} />
              <b>预填失败</b>
            </span>
            <small>{errorResults.length} 单</small>
          </header>
          <div className="vacant-fill-result-list">
            {errorResults.map((result) => (
              <article key={result.woHeaderId} className="vacant-fill-result-card error">
                <div className="vacant-fill-result-header">
                  <b>{result.unit}</b>
                  <span>{result.woNumber || result.woHeaderId}</span>
                </div>
                <p className="vacant-fill-result-detail error-message">{result.error}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <details className="vacant-fill-boundary">
        <summary>批量预填说明</summary>
        <p>
          批量检查当天所有待处理的居民安检工单，自动获取每个工单上一年度的历史数据。
        </p>
        <p>
          预填内容包括：已批准的选择项、人口信息、设备品牌型号、使用年限和热水器升数等。
        </p>
        <p>
          自动跳过已有相同内容的工单；失败工单不影响其他工单的预填，可在单工单模式中单独处理。
        </p>
        <p>批量预存只调用 editAct 接口，不提交或关闭工单。</p>
      </details>

      {message ? (
        <p className="vacant-room-global-message" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}

      <div className="vacant-room-actions vacant-fill-actions resident-prefill-actions">
        {state.status === "paused" ? (
          <button
            type="button"
            className="secondary-button"
            onClick={continueOperation}
          >
            <Icon name="play" size={16} />
            继续执行
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={busy || !residentOrders.length}
            onClick={() => void startBatchPrefill()}
          >
            <Icon name={state.status === "error" ? "refresh" : "note"} size={16} />
            {busy ? "正在处理" : "一键检查并预填"}
          </button>
        )}
        {busy ? (
          <button
            type="button"
            className="secondary-button pause-button"
            onClick={pauseOperation}
          >
            <Icon name="pause" size={16} />
            暂停
          </button>
        ) : null}
      </div>
    </>
  );
}
