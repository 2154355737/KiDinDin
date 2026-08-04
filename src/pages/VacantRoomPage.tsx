import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/Navigation";
import {
  clearVacantRoomImageCache,
  defaultVacantRoomImageHashes,
  extractVacantRoomOrder,
  saveVacantRoomImages,
  vacantRoomImageDisplayName,
  type VacantRoomExtraction,
  type VacantRoomProgressStage,
} from "../services/vacantRoomApi";
import type { WorkOrder } from "../types/workOrder";

type ExtractionStatus =
  | "idle"
  | "queued"
  | "running"
  | "ready"
  | "error"
  | "saved";

type OrderExtractionState = {
  extraction?: VacantRoomExtraction;
  message: string;
  stage?: VacantRoomProgressStage;
  status: ExtractionStatus;
};

export type VacantRoomPageProps = {
  autoSelectImages?: boolean;
  autoSelectOrders?: boolean;
  date: string;
  onBack: () => void;
  onDateChange: (value: string) => void;
  orders: WorkOrder[];
};

function statusLabel(status: ExtractionStatus) {
  switch (status) {
    case "queued":
      return "等待中";
    case "running":
      return "提取中";
    case "ready":
      return "待保存";
    case "saved":
      return "已保存";
    case "error":
      return "未取到";
    default:
      return "待提取";
  }
}

function byteSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

export function VacantRoomPage({
  autoSelectImages = true,
  autoSelectOrders = true,
  date,
  onBack,
  onDateChange,
  orders,
}: VacantRoomPageProps) {
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
  const [selectedImageHashes, setSelectedImageHashes] = useState<
    Record<string, string[]>
  >({});
  const [results, setResults] = useState<Record<string, OrderExtractionState>>(
    {},
  );
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const cancelledRef = useRef(false);

  useEffect(() => {
    setSelectedOrderIds(autoSelectOrders && vacantOrderKey ? vacantOrderKey.split("|") : []);
    setSelectedImageHashes({});
    setResults({});
    setMessage("");
  }, [autoSelectOrders, date, vacantOrderKey]);

  const selectedOrders = useMemo(() => {
    const selected = new Set(selectedOrderIds);
    return vacantOrders.filter((order) => selected.has(order.id));
  }, [selectedOrderIds, vacantOrders]);

  const initialImageHashes = (extraction: VacantRoomExtraction) =>
    autoSelectImages ? defaultVacantRoomImageHashes(extraction.images) : [];

  const extractedImages = useMemo(
    () =>
      vacantOrders.flatMap((order) => {
        const extraction = results[order.id]?.extraction;
        if (!extraction) return [];
        const selected = new Set(
          selectedImageHashes[order.id] ?? initialImageHashes(extraction),
        );
        return extraction.images.flatMap((image, index) =>
          selected.has(image.sha256) ? [{ image, index, order }] : [],
        );
      }),
    [autoSelectImages, results, selectedImageHashes, vacantOrders],
  );

  const updateResult = (id: string, patch: Partial<OrderExtractionState>) => {
    setResults((current) => {
      const previous = current[id] ?? {
        message: "等待提取",
        status: "idle" as const,
      };
      return { ...current, [id]: { ...previous, ...patch } };
    });
  };

  const runExtraction = async () => {
    if (!selectedOrders.length || running) return;
    cancelledRef.current = false;
    setRunning(true);
    setMessage(`准备提取 ${selectedOrders.length} 个空房工单`);
    setResults((current) => {
      const next = { ...current };
      for (const order of selectedOrders) {
        next[order.id] = { message: "等待进入提取队列", status: "queued" };
      }
      return next;
    });

    let cursor = 0;
    let successCount = 0;
    const worker = async () => {
      while (!cancelledRef.current && cursor < selectedOrders.length) {
        const order = selectedOrders[cursor];
        cursor += 1;
        updateResult(order.id, { message: "正在查询历史安检单", status: "running" });
        try {
          const extraction = await extractVacantRoomOrder(
            order,
            date,
            (stage, progressMessage) =>
              updateResult(order.id, {
                message: progressMessage,
                stage,
                status: "running",
              }),
          );
          successCount += 1;
          setSelectedImageHashes((current) => ({
            ...current,
            [order.id]: initialImageHashes(extraction),
          }));
          updateResult(order.id, {
            extraction,
            message: `${extraction.rawAttachmentCount} 个附件，去重后 ${extraction.images.length} 张`,
            status: "ready",
          });
        } catch (error) {
          updateResult(order.id, {
            message: error instanceof Error ? error.message : "提取失败",
            status: "error",
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(2, selectedOrders.length) }, () => worker()),
    );
    setRunning(false);
    if (cancelledRef.current) {
      setMessage("已停止继续提取；已完成结果仍可保存");
    } else {
      setMessage(
        successCount
          ? `提取结束：${successCount} 单成功，${selectedOrders.length - successCount} 单未取到`
          : "提取结束，所选工单均未取到照片",
      );
    }
  };

  const retryOrder = async (order: WorkOrder) => {
    if (running) return;
    updateResult(order.id, { message: "正在重新提取", status: "running" });
    try {
      const extraction = await extractVacantRoomOrder(
        order,
        date,
        (stage, progressMessage) =>
          updateResult(order.id, {
            message: progressMessage,
            stage,
            status: "running",
          }),
      );
      setSelectedImageHashes((current) => ({
        ...current,
        [order.id]: initialImageHashes(extraction),
      }));
      updateResult(order.id, {
        extraction,
        message: `${extraction.rawAttachmentCount} 个附件，去重后 ${extraction.images.length} 张`,
        status: "ready",
      });
    } catch (error) {
      updateResult(order.id, {
        message: error instanceof Error ? error.message : "提取失败",
        status: "error",
      });
    }
  };

  const saveImages = async () => {
    if (!extractedImages.length || saving) return;
    setSaving(true);
    setMessage(`正在保存 ${extractedImages.length} 张图片到系统相册…`);
    try {
      const response = await saveVacantRoomImages(
        extractedImages.map(({ image, index, order }) => ({
          cacheKey: image.cacheKey,
          displayName: vacantRoomImageDisplayName(order, image, index),
          mime: image.mime,
        })),
        date,
      );
      const savedCounts = new Map<string, number>();
      for (const { order } of extractedImages) {
        savedCounts.set(order.id, (savedCounts.get(order.id) ?? 0) + 1);
      }
      setResults((current) => {
        const next = { ...current };
        for (const [id, savedCount] of savedCounts) {
          const state = next[id];
          if (!state?.extraction) continue;
          const total = state.extraction.images.length;
          next[id] = {
            ...state,
            message: `本次已保存 ${savedCount}/${total} 张`,
            status: savedCount === total ? "saved" : "ready",
          };
        }
        return next;
      });
      setMessage(`已保存 ${response.saved.length} 张图片到 Pictures/KiDinDin/空房取单/${date}，手机相册将按本次拍摄时间集中排序`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存到相册失败");
    } finally {
      setSaving(false);
    }
  };

  const clearResults = async () => {
    if (running || saving) return;
    try {
      await clearVacantRoomImageCache();
      setResults({});
      setSelectedImageHashes({});
      setMessage("本次提取缓存已清除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清除缓存失败");
    }
  };

  return (
    <>
      <SubHeader
        title="空房取单"
        date={date}
        onDateChange={(value) => {
          if (!running && !saving) onDateChange(value);
        }}
        onBack={() => {
          cancelledRef.current = true;
          onBack();
        }}
      />

      <section className="vacant-room-hero">
        <div>
          <span>当前日期识别</span>
          <strong>{vacantOrders.length}</strong>
          <b>个空房工单</b>
        </div>
        <p>只读取同户最近一次已完成安检单，下载、去重后由你确认保存。</p>
      </section>

      <section className="vacant-room-toolbar">
        <div>
          <b>批量范围</b>
          <span>已选 {selectedOrderIds.length}/{vacantOrders.length} 单</span>
        </div>
        <button
          type="button"
          disabled={running || !vacantOrders.length}
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

      {!vacantOrders.length ? (
        <section className="vacant-room-empty">
          <Icon name="home" size={24} />
          <b>当天没有识别到空房工单</b>
          <span>空房按住户字段中的“需首检”识别。</span>
        </section>
      ) : (
        <section className="vacant-room-list">
          {vacantOrders.map((order) => {
            const state = results[order.id];
            const selected = selectedOrderIds.includes(order.id);
            const extraction = state?.extraction;
            const selectedHashes = new Set(
              selectedImageHashes[order.id] ??
                (extraction ? initialImageHashes(extraction) : []),
            );
            return (
              <article key={order.id} className={`vacant-room-card status-${state?.status ?? "idle"}`}>
                <button
                  type="button"
                  className="vacant-room-order-select"
                  disabled={running}
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
                {extraction ? (
                  <>
                    <div className="vacant-room-history-meta">
                      <span>历史单 {extraction.historyWoNumber}</span>
                      <span>{extraction.historyCompletedAt || "完成时间未知"}</span>
                    </div>
                    <div className="vacant-room-image-grid">
                      {extraction.images.map((image) => {
                        const imageSelected = selectedHashes.has(image.sha256);
                        return (
                          <button
                            type="button"
                            key={image.sha256}
                            className={imageSelected ? "selected" : ""}
                            aria-pressed={imageSelected}
                            disabled={saving}
                            onClick={() =>
                              setSelectedImageHashes((current) => {
                                const hashes = new Set(
                                  current[order.id] ?? initialImageHashes(extraction),
                                );
                                if (hashes.has(image.sha256)) hashes.delete(image.sha256);
                                else hashes.add(image.sha256);
                                return { ...current, [order.id]: [...hashes] };
                              })
                            }
                          >
                            <img src={image.previewDataUrl} alt={image.labels.join("、")} />
                            <span>{image.labels[0]}</span>
                            <small>{byteSize(image.size)}{image.labels.length > 1 ? ` · ${image.labels.length} 项复用` : ""}</small>
                            <i>{imageSelected ? <Icon name="check" size={11} /> : null}</i>
                          </button>
                        );
                      })}
                    </div>
                    {extraction.warnings.length ? (
                      <details className="vacant-room-warnings">
                        <summary>{extraction.warnings.length} 条部分失败信息</summary>
                        {extraction.warnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}
                      </details>
                    ) : null}
                  </>
                ) : null}
                {state?.status === "error" ? (
                  <button type="button" className="vacant-room-retry" onClick={() => void retryOrder(order)}>
                    <Icon name="refresh" size={14} />重新提取
                  </button>
                ) : null}
              </article>
            );
          })}
        </section>
      )}

      <p className="vacant-room-security-note">
        此功能不会上传图片、关闭工单或写入流转日志。相册文件会在卸载应用后继续保留。
      </p>
      {message ? <p className="vacant-room-global-message" role="status" aria-live="polite">{message}</p> : null}

      <div className="vacant-room-actions">
        {running ? (
          <button type="button" className="secondary-button" onClick={() => { cancelledRef.current = true; setMessage("正在停止，当前请求完成后结束…"); }}>
            停止继续提取
          </button>
        ) : (
          <button type="button" className="primary-button" disabled={!selectedOrders.length || saving} onClick={() => void runExtraction()}>
            <Icon name="download" size={16} />一键提取 {selectedOrders.length ? `${selectedOrders.length} 单` : ""}
          </button>
        )}
        <button type="button" className="primary-button" disabled={!extractedImages.length || running || saving} onClick={() => void saveImages()}>
          <Icon name="download" size={16} />{saving ? "正在保存…" : `保存选中 ${extractedImages.length} 张`}
        </button>
        <button type="button" className="vacant-room-clear" disabled={running || saving || !Object.keys(results).length} onClick={() => void clearResults()}>
          清除缓存
        </button>
      </div>
    </>
  );
}
