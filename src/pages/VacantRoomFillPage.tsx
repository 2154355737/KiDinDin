import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/Navigation";
import {
  inspectVacantRoomFill,
  saveVacantRoomFill,
  type VacantRoomFillPreview,
} from "../services/vacantRoomFillApi";
import type { WorkOrder } from "../types/workOrder";

type FillStatus =
  | "idle"
  | "checking"
  | "ready"
  | "saving"
  | "saved"
  | "skipped"
  | "error";

type FillState = {
  message: string;
  preview?: VacantRoomFillPreview;
  status: FillStatus;
};

export type VacantRoomFillPageProps = {
  autoSelectOrders?: boolean;
  date: string;
  defaultIntervalSeconds?: number;
  onBack: () => void;
  onDateChange: (value: string) => void;
  orders: WorkOrder[];
};

function statusLabel(status: FillStatus) {
  switch (status) {
    case "checking":
      return "检查中";
    case "ready":
      return "待预存";
    case "saving":
      return "预存中";
    case "saved":
      return "已预存";
    case "skipped":
      return "无需处理";
    case "error":
      return "已跳过";
    default:
      return "待检查";
  }
}

export function VacantRoomFillPage({
  autoSelectOrders = true,
  date,
  defaultIntervalSeconds = 2,
  onBack,
  onDateChange,
  orders,
}: VacantRoomFillPageProps) {
  const vacantOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          order.backendStatusCode === "20" && order.resident.includes("需首检"),
      ),
    [orders],
  );
  const vacantOrderKey = vacantOrders.map((order) => order.id).join("|");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [states, setStates] = useState<Record<string, FillState>>({});
  const [action, setAction] = useState<"" | "checking" | "saving">("");
  const [saveIntervalSeconds, setSaveIntervalSeconds] = useState(defaultIntervalSeconds);
  const [message, setMessage] = useState("");
  const cancelledRef = useRef(false);

  useEffect(() => {
    setSelectedOrderIds(autoSelectOrders && vacantOrderKey ? vacantOrderKey.split("|") : []);
    setSaveIntervalSeconds(defaultIntervalSeconds);
    setStates({});
    setMessage("");
  }, [autoSelectOrders, date, defaultIntervalSeconds, vacantOrderKey]);

  const selectedOrders = useMemo(() => {
    const selected = new Set(selectedOrderIds);
    return vacantOrders.filter((order) => selected.has(order.id));
  }, [selectedOrderIds, vacantOrders]);

  const readyOrders = useMemo(
    () => selectedOrders.filter((order) => states[order.id]?.status === "ready"),
    [selectedOrders, states],
  );

  const updateState = (id: string, next: FillState) => {
    setStates((current) => ({ ...current, [id]: next }));
  };

  const unselectOrder = (id: string) => {
    setSelectedOrderIds((current) => current.filter((item) => item !== id));
  };

  const runWorkers = async (
    items: WorkOrder[],
    task: (order: WorkOrder) => Promise<void>,
  ) => {
    let cursor = 0;
    const worker = async () => {
      while (!cancelledRef.current && cursor < items.length) {
        const order = items[cursor];
        cursor += 1;
        await task(order);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(2, items.length) }, () => worker()),
    );
  };

  const inspectOne = async (order: WorkOrder) => {
    updateState(order.id, { message: "正在读取当前安检表单", status: "checking" });
    try {
      const preview = await inspectVacantRoomFill(order);
      updateState(order.id, {
        message:
          preview.prefillCount > 0
            ? `将预填 ${preview.prefillCount} 项，保留现有 ${preview.preservedFieldCount} 项`
            : "默认选项已经存在，不会重复写入",
        preview,
        status: preview.prefillCount > 0 ? "ready" : "skipped",
      });
      if (preview.prefillCount === 0) unselectOrder(order.id);
      return preview.prefillCount > 0;
    } catch (error) {
      updateState(order.id, {
        message: error instanceof Error ? error.message : "检查失败",
        status: "error",
      });
      return false;
    }
  };

  const inspectSelected = async () => {
    if (!selectedOrders.length || action) return;
    cancelledRef.current = false;
    setAction("checking");
    setMessage(`正在检查 ${selectedOrders.length} 张空房工单，不会写入数据`);
    let readyCount = 0;
    await runWorkers(selectedOrders, async (order) => {
      if (await inspectOne(order)) readyCount += 1;
    });
    setAction("");
    setMessage(
      cancelledRef.current
        ? "已停止继续检查"
        : `检查完成：${readyCount} 单可预存，请确认后执行`,
    );
  };

  const retryInspection = async (order: WorkOrder) => {
    if (action) return;
    cancelledRef.current = false;
    setAction("checking");
    await inspectOne(order);
    setAction("");
  };

  const saveSelected = async () => {
    if (!readyOrders.length || action) return;
    const targets = [...readyOrders];
    cancelledRef.current = false;
    setAction("saving");
    setMessage(`正在按顺序预存 ${targets.length} 张工单，期间不会提交或关单`);
    let savedCount = 0;
    for (let index = 0; index < targets.length; index += 1) {
      if (cancelledRef.current) break;
      const order = targets[index];
      updateState(order.id, { message: "正在重新校验并预存", status: "saving" });
      try {
        const preview = await saveVacantRoomFill(order);
        const saved = preview.prefillCount > 0;
        if (saved) savedCount += 1;
        updateState(order.id, {
          message: saved
            ? `已预存 ${preview.prefillCount} 项，原有内容未覆盖`
            : "检查时数据已变化，当前无需重复预存",
          preview,
          status: saved ? "saved" : "skipped",
        });
        if (!saved) unselectOrder(order.id);
      } catch (error) {
        updateState(order.id, {
          message: error instanceof Error ? error.message : "预存失败",
          status: "error",
        });
      }
      const hasNext = index < targets.length - 1 && !cancelledRef.current;
      if (hasNext && saveIntervalSeconds > 0) {
        setMessage(
          `已处理 ${index + 1}/${targets.length} 单，等待 ${saveIntervalSeconds} 秒后继续`,
        );
        const deadline = Date.now() + saveIntervalSeconds * 1000;
        while (!cancelledRef.current && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    }
    setAction("");
    setMessage(
      cancelledRef.current
        ? `已停止继续预存，本次成功 ${savedCount} 单`
        : `预存结束：成功 ${savedCount}/${targets.length} 单`,
    );
  };

  const busy = Boolean(action);

  return (
    <>
      <SubHeader
        title="空房填单"
        date={date}
        onDateChange={(value) => {
          if (!busy) onDateChange(value);
        }}
        onBack={() => {
          cancelledRef.current = true;
          onBack();
        }}
      />

      <section className="vacant-room-hero vacant-fill-hero">
        <div>
          <span>当前日期识别</span>
          <strong>{vacantOrders.length}</strong>
          <b>个待处理空房</b>
        </div>
        <p>先检查、再确认预存；保留每户表具、安全卡、图片和已有内容。</p>
      </section>

      <section className="vacant-room-toolbar">
        <div>
          <b>批量范围</b>
          <span>已选 {selectedOrderIds.length}/{vacantOrders.length} 单</span>
        </div>
        <button
          type="button"
          disabled={busy || !vacantOrders.length}
          onClick={() =>
            setSelectedOrderIds((current) =>
              current.length === vacantOrders.length
                ? []
                : vacantOrders.map((order) => order.id),
            )
          }
        >
          {selectedOrderIds.length === vacantOrders.length ? "取消全选" : "全部选择"}
        </button>
      </section>

      <label className="vacant-fill-interval">
        <span>
          <b>预存间隔</b>
          <small>仅作用于逐单写入，检查阶段不等待</small>
        </span>
        <select
          value={saveIntervalSeconds}
          disabled={busy}
          onChange={(event) => setSaveIntervalSeconds(Number(event.target.value))}
        >
          <option value={0}>不间隔</option>
          <option value={1}>1 秒</option>
          <option value={2}>2 秒</option>
          <option value={3}>3 秒</option>
          <option value={5}>5 秒</option>
          <option value={10}>10 秒</option>
        </select>
      </label>

      {!vacantOrders.length ? (
        <section className="vacant-room-empty">
          <Icon name="note" size={24} />
          <b>当天没有可预填的空房工单</b>
          <span>仅识别待处理且住户字段包含“需首检”的工单。</span>
        </section>
      ) : (
        <section className="vacant-room-list">
          {vacantOrders.map((order) => {
            const state = states[order.id];
            const selected = selectedOrderIds.includes(order.id);
            return (
              <article
                key={order.id}
                className={`vacant-room-card vacant-fill-card status-${state?.status ?? "idle"}`}
              >
                <button
                  type="button"
                  className="vacant-room-order-select"
                  disabled={busy}
                  aria-pressed={selected}
                  onClick={() =>
                    setSelectedOrderIds((current) =>
                      current.includes(order.id)
                        ? current.filter((id) => id !== order.id)
                        : [...current, order.id],
                    )
                  }
                >
                  <span className={selected ? "selected" : ""} aria-hidden="true">
                    {selected ? <Icon name="check" size={13} /> : null}
                  </span>
                  <span>
                    <b>{order.unit}</b>
                    <small>{order.woNumber || order.id} · {order.resident}</small>
                  </span>
                  <em>{statusLabel(state?.status ?? "idle")}</em>
                </button>

                {state ? <p className="vacant-room-message">{state.message}</p> : null}
                {state?.preview ? (
                  <div className="vacant-fill-preview">
                    <span><b>{state.preview.prefillCount}</b> 项默认值</span>
                    <span><b>{state.preview.preservedFieldCount}</b> 项已保留</span>
                    <span><b>{state.preview.lineCount}</b> 行表单</span>
                  </div>
                ) : null}
                {state?.status === "error" && !busy ? (
                  <button
                    type="button"
                    className="vacant-room-retry"
                    onClick={() => void retryInspection(order)}
                  >
                    <Icon name="refresh" size={14} />重新检查
                  </button>
                ) : null}
              </article>
            );
          })}
        </section>
      )}

      <details className="vacant-fill-boundary">
        <summary>预填内容与安全边界</summary>
        <p>填写空房样本中的常规选项，不复制其他住户表号、安全卡、照片或录音时间。</p>
        <p>不会调用入户定位、照片上传、提交、关单或流转日志接口。</p>
      </details>
      {message ? (
        <p className="vacant-room-global-message" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}

      <div className="vacant-room-actions vacant-fill-actions">
        {busy ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              cancelledRef.current = true;
              setMessage("正在停止，当前请求完成后结束…");
            }}
          >
            停止继续{action === "saving" ? "预存" : "检查"}
          </button>
        ) : (
          <button
            type="button"
            className="secondary-button"
            disabled={!selectedOrders.length}
            onClick={() => void inspectSelected()}
          >
            <Icon name="audit" size={16} />检查所选 {selectedOrders.length || ""} 单
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          disabled={busy || !readyOrders.length}
          onClick={() => void saveSelected()}
        >
          <Icon name="note" size={16} />确认预存 {readyOrders.length || ""} 单
        </button>
      </div>
    </>
  );
}
