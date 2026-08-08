import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/Navigation";
import {
  inspectResidentSecurityPrefill,
  isResidentSecurityPrefillTarget,
  saveResidentSecurityPrefill,
  type ResidentSecurityPrefillPreview,
} from "../services/residentSecurityPrefillApi";
import type { WorkOrder } from "../types/workOrder";

type PrefillStatus =
  | "idle"
  | "checking"
  | "ready"
  | "saving"
  | "saved"
  | "skipped"
  | "error";

type PrefillState = {
  message: string;
  preview?: ResidentSecurityPrefillPreview;
  status: PrefillStatus;
};

export type ResidentSecurityPrefillPageProps = {
  date: string;
  onBack: () => void;
  onDateChange: (value: string) => void;
  orders: WorkOrder[];
};

function statusLabel(status: PrefillStatus) {
  switch (status) {
    case "checking":
      return "核对中";
    case "ready":
      return "待预存";
    case "saving":
      return "预存中";
    case "saved":
      return "已预存";
    case "skipped":
      return "无需处理";
    case "error":
      return "检查失败";
    default:
      return "待检查";
  }
}

function matchesQuery(order: WorkOrder, query: string) {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return true;
  return [
    order.searchText,
    order.woNumber,
    order.resident,
    order.address,
    order.unit,
    order.building,
    order.unitNumber,
    order.floorNumber,
  ].some((value) => String(value ?? "").toLocaleLowerCase().includes(keyword));
}

export function ResidentSecurityPrefillPage({
  date,
  onBack,
  onDateChange,
  orders,
}: ResidentSecurityPrefillPageProps) {
  const residentOrders = useMemo(
    () => orders.filter(isResidentSecurityPrefillTarget),
    [orders],
  );
  const residentOrderKey = residentOrders.map((order) => order.id).join("|");
  const [query, setQuery] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [state, setState] = useState<PrefillState>();
  const [message, setMessage] = useState("");

  const filteredOrders = useMemo(
    () => residentOrders.filter((order) => matchesQuery(order, query)),
    [query, residentOrders],
  );
  const selectedOrder = useMemo(
    () => residentOrders.find((order) => order.id === selectedOrderId),
    [residentOrders, selectedOrderId],
  );
  const busy = state?.status === "checking" || state?.status === "saving";

  useEffect(() => {
    setQuery("");
    setSelectedOrderId("");
    setState(undefined);
    setMessage("");
  }, [date, residentOrderKey]);

  const selectOrder = (order: WorkOrder) => {
    if (busy) return;
    setSelectedOrderId((current) => (current === order.id ? "" : order.id));
    setState(undefined);
    setMessage("");
  };

  const changeQuery = (value: string) => {
    setQuery(value);
    if (selectedOrder && !matchesQuery(selectedOrder, value)) {
      setSelectedOrderId("");
      setState(undefined);
      setMessage("");
    }
  };

  const inspectSelected = async () => {
    if (!selectedOrder || busy) return;
    setState({ message: "正在核对上一年居民安检单及隐患摘要", status: "checking" });
    setMessage("检查阶段只读取数据，不会写入工单");
    try {
      const preview = await inspectResidentSecurityPrefill(selectedOrder);
      const ready = preview.prefillCount > 0;
      setState({
        message: ready
          ? `来源 ${preview.historyYear} 年 ${preview.historyWoNumber}，将预填 ${preview.prefillCount} 项`
          : `${preview.historyYear} 年历史选项在今年表单中已经存在`,
        preview,
        status: ready ? "ready" : "skipped",
      });
      setMessage(ready ? "请核对历史来源和隐患摘要后确认预存" : "当前工单无需重复预存");
    } catch (error) {
      setState({
        message: error instanceof Error ? error.message : "检查失败",
        status: "error",
      });
      setMessage("检查失败，未写入任何数据");
    }
  };

  const saveSelected = async () => {
    if (!selectedOrder || state?.status !== "ready" || !state.preview || busy) return;
    const inspected = state.preview;
    setState({
      message: "正在重新校验并预存当前工单",
      preview: inspected,
      status: "saving",
    });
    setMessage("只调用安检表单 editAct 预存接口");
    try {
      const preview = await saveResidentSecurityPrefill(
        selectedOrder,
        inspected.historyWoHeaderId,
      );
      const saved = preview.prefillCount > 0;
      setState({
        message: saved
          ? `已从 ${preview.historyYear} 年工单预存 ${preview.prefillCount} 项选择结果`
          : "重新校验后数据已变化，当前无需重复预存",
        preview,
        status: saved ? "saved" : "skipped",
      });
      setMessage(saved ? "预存成功，已读取今年工单的隐患结果" : "没有执行重复写入");
    } catch (error) {
      setState({
        message: error instanceof Error ? error.message : "预存失败",
        preview: inspected,
        status: "error",
      });
      setMessage("预存失败，请重新检查后再试");
    }
  };

  const preview = state?.preview;

  return (
    <>
      <SubHeader
        title="安检预填"
        date={date}
        onDateChange={(value) => {
          if (!busy) onDateChange(value);
        }}
        onBack={onBack}
      />

      <section className="vacant-room-hero vacant-fill-hero resident-prefill-hero">
        <div>
          <span>单工单模式</span>
          <strong>{residentOrders.length}</strong>
          <b>个待处理居民安检</b>
        </div>
        <p>搜索并选择一张工单，核对上一年度历史来源后单独预存，不提供批量操作。</p>
      </section>

      <label className="search-bar resident-prefill-search">
        <Icon name="search" size={17} />
        <input
          value={query}
          disabled={busy}
          onChange={(event) => changeQuery(event.target.value)}
          placeholder="搜索工单号、住户、楼栋或地址"
          aria-label="搜索居民安检工单"
        />
        {query ? (
          <button type="button" disabled={busy} onClick={() => setQuery("")} aria-label="清除搜索">
            <Icon name="close" size={15} />
          </button>
        ) : null}
      </label>

      <section className="vacant-room-toolbar resident-prefill-toolbar">
        <div>
          <b>搜索结果</b>
          <span>{filteredOrders.length}/{residentOrders.length} 单</span>
        </div>
        <span>{selectedOrder ? `已选：${selectedOrder.resident}` : "请选择一张工单"}</span>
      </section>

      {!residentOrders.length ? (
        <section className="vacant-room-empty">
          <Icon name="note" size={24} />
          <b>当天没有待处理的居民安检工单</b>
          <span>仅识别待处理且类型为安检 / 居民安检的非空房工单。</span>
        </section>
      ) : !filteredOrders.length ? (
        <section className="vacant-room-empty">
          <Icon name="search" size={24} />
          <b>没有匹配的居民安检工单</b>
          <span>可搜索工单号、住户、楼栋、单元或详细地址。</span>
        </section>
      ) : (
        <section className="vacant-room-list">
          {filteredOrders.map((order) => {
            const selected = order.id === selectedOrderId;
            const orderState = selected ? state : undefined;
            return (
              <article
                key={order.id}
                className={`vacant-room-card vacant-fill-card status-${orderState?.status ?? "idle"}`}
              >
                <button
                  type="button"
                  className="vacant-room-order-select"
                  disabled={busy}
                  aria-pressed={selected}
                  onClick={() => selectOrder(order)}
                >
                  <span className={selected ? "selected" : ""} aria-hidden="true">
                    {selected ? <Icon name="check" size={13} /> : null}
                  </span>
                  <span>
                    <b>{order.unit}</b>
                    <small>{order.woNumber || order.id} · {order.resident}</small>
                  </span>
                  <em>{statusLabel(orderState?.status ?? "idle")}</em>
                </button>

                {orderState ? <p className="vacant-room-message">{orderState.message}</p> : null}
                {selected && preview ? (
                  <>
                    <div className="vacant-fill-preview">
                      <span><b>{preview.prefillCount}</b> 项历史选项</span>
                      <span><b>{preview.preservedChoiceCount}</b> 项今年保留</span>
                      <span><b>{preview.excludedFieldCount}</b> 项安全排除</span>
                    </div>
                    <p className="resident-prefill-source">
                      {preview.historyYear} 年 · {preview.historyCompletedAt || "完成时间未知"}
                    </p>
                  </>
                ) : null}
              </article>
            );
          })}
        </section>
      )}

      {preview ? (
        <section className={`resident-prefill-hazards hazard-${preview.hazardStatus}`}>
          <header>
            <div>
              <b>{preview.hazardSource === "current" ? "预存后隐患结果" : "去年隐患摘要"}</b>
              <span>{preview.hazardMessage}</span>
            </div>
            <em>{preview.hazards.length} 项</em>
          </header>
          {preview.hazards.length ? (
            <div className="resident-prefill-hazard-list">
              {preview.hazards.map((hazard) => (
                <article key={`${hazard.order}-${hazard.actCode}`}>
                  <div>
                    <strong>{hazard.order}. {hazard.hint}</strong>
                    <span>{[hazard.checkResultName, hazard.checkLevel].filter(Boolean).join(" · ")}</span>
                  </div>
                  {hazard.correctiveSuggestion ? <p>{hazard.correctiveSuggestion}</p> : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <details className="vacant-fill-boundary">
        <summary>历史范围与写入边界</summary>
        <p>只允许逐单操作；仅接受当前工单上一年度、状态 50、名称为“居民安检单”的同户同供气点工单。</p>
        <p>只复制选择结果；文本、数字、日期、表具、安全卡、照片及 PZ 字段全部排除。</p>
        <p>隐患摘要通过 previewVo 只读接口获取；确认预存仍只调用 editAct，不提交或关闭工单。</p>
      </details>

      {message ? (
        <p className="vacant-room-global-message" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}

      <div className="vacant-room-actions vacant-fill-actions resident-prefill-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !selectedOrder}
          onClick={() => void inspectSelected()}
        >
          <Icon name={state?.status === "error" ? "refresh" : "audit"} size={16} />
          {state?.status === "checking" ? "正在检查" : "检查当前工单"}
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || state?.status !== "ready"}
          onClick={() => void saveSelected()}
        >
          <Icon name="note" size={16} />
          {state?.status === "saving" ? "正在预存" : "确认预存当前工单"}
        </button>
      </div>
    </>
  );
}
