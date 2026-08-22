import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../components/Icon";
import {
  deleteSignatureRecord,
  getSignatureRecord,
  saveSignatureRecord,
  type SignatureRecord,
} from "../services/signatureStore";
import type { WorkOrder } from "../types/workOrder";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("生成签字图片失败，请重新签字"));
    }, "image/png");
  });
}

export function SignaturePage({
  accountKey,
  order,
  onBack,
  onSignatureChange,
}: {
  accountKey: string | null;
  order: WorkOrder;
  onBack: () => void;
  onSignatureChange: (woHeaderId: string, saved: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const requestedFullscreenRef = useRef(false);
  const orientationLockedRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [signaturePadOpen, setSignaturePadOpen] = useState(false);
  const [draftBlob, setDraftBlob] = useState<Blob | null>(null);
  const [draftPreviewUrl, setDraftPreviewUrl] = useState("");
  const [existing, setExisting] = useState<SignatureRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [signerName, setSignerName] = useState(order.resident.replace(/需首检/g, "").trim());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const initializeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#172033";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    hasInkRef.current = false;
    setHasInk(false);
  }, []);

  useEffect(() => {
    if (!signaturePadOpen) return;
    const frame = window.requestAnimationFrame(initializeCanvas);
    const resize = () => {
      if (!drawingRef.current && !hasInkRef.current) initializeCanvas();
    };
    window.addEventListener("resize", resize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [initializeCanvas, signaturePadOpen]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    if (!accountKey) {
      setExisting(null);
      setLoading(false);
      setMessage("当前登录缺少本地账号标识，无法保存离线签字");
      return () => {
        active = false;
      };
    }
    void getSignatureRecord(accountKey, order.woHeaderId)
      .then((record) => {
        if (!active) return;
        setExisting(record);
        if (record) setSignerName(record.signerName);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "读取签字记录失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountKey, order.woHeaderId]);

  useEffect(() => {
    if (!existing) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(existing.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [existing]);

  useEffect(() => {
    if (!draftBlob) {
      setDraftPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(draftBlob);
    setDraftPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draftBlob]);

  const leaveFullscreen = useCallback(() => {
    const orientation = screen.orientation as ScreenOrientation & {
      unlock?: () => void;
    };
    if (orientationLockedRef.current) {
      orientation.unlock?.();
      orientationLockedRef.current = false;
    }
    if (requestedFullscreenRef.current && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    requestedFullscreenRef.current = false;
  }, []);

  const closeSignaturePad = useCallback(() => {
    drawingRef.current = false;
    setSignaturePadOpen(false);
    leaveFullscreen();
  }, [leaveFullscreen]);

  const openSignaturePad = () => {
    setMessage("");
    void (async () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        try {
          await document.documentElement.requestFullscreen();
          requestedFullscreenRef.current = true;
        } catch {
          requestedFullscreenRef.current = false;
        }
      }
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (orientation: "landscape") => Promise<void>;
      };
      try {
        await orientation.lock?.("landscape");
        orientationLockedRef.current = Boolean(orientation.lock);
      } catch {
        orientationLockedRef.current = false;
      }
      setSignaturePadOpen(true);
    })();
  };

  const acceptSignature = async () => {
    if (!hasInk || !canvasRef.current) {
      setMessage("请先在横向签字区域手写签名");
      return;
    }
    try {
      setDraftBlob(await canvasBlob(canvasRef.current));
      setMessage("签字已完成，请确认姓名后保存记录");
      closeSignaturePad();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成签字图片失败");
    }
  };

  useEffect(() => {
    const back = (event: Event) => {
      event.preventDefault();
      if (signaturePadOpen) closeSignaturePad();
      else onBack();
    };
    window.addEventListener("kidindin:back", back);
    return () => window.removeEventListener("kidindin:back", back);
  }, [closeSignaturePad, onBack, signaturePadOpen]);

  useEffect(() => () => leaveFullscreen(), [leaveFullscreen]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    return {
      x: event.nativeEvent.offsetX,
      y: event.nativeEvent.offsetY,
    };
  };

  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (saving) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const current = point(event);
    drawingRef.current = true;
    context.beginPath();
    context.moveTo(current.x, current.y);
    context.lineTo(current.x + 0.01, current.y + 0.01);
    context.stroke();
    hasInkRef.current = true;
    setHasInk(true);
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const current = point(event);
    context.lineTo(current.x, current.y);
    context.stroke();
  };

  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    event.currentTarget.getContext("2d")?.closePath();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const save = async () => {
    if (!accountKey || saving) return;
    if (!signerName.trim()) {
      setMessage("请填写签字人姓名");
      return;
    }
    if (!draftBlob) {
      setMessage("请先进入横向全屏签字并点击完成");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const record = await saveSignatureRecord(
        accountKey,
        order,
        signerName,
        draftBlob,
      );
      setExisting(record);
      setDraftBlob(null);
      onSignatureChange(order.woHeaderId, true);
      setMessage(existing ? "已更新本机签字记录" : "签字已保存到本机");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存签字失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!accountKey || !existing || saving) return;
    if (!window.confirm("确定删除当前工单的本地签字记录吗？")) return;
    setSaving(true);
    setMessage("");
    try {
      await deleteSignatureRecord(accountKey, order.woHeaderId);
      setExisting(null);
      setDraftBlob(null);
      onSignatureChange(order.woHeaderId, false);
      initializeCanvas();
      setMessage("本地签字记录已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除签字失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="signature-page">
      <header className="subheader signature-header">
        <button type="button" className="back-button" onClick={onBack} aria-label="返回">
          <Icon name="chevron" />
        </button>
        <h1>工单签字</h1>
        <span className="signature-local-pill">仅本机</span>
      </header>

      <section className="signature-order-card">
        <div><span>工单</span><b>{order.woNumber || order.id}</b></div>
        <h2>{order.resident} · {order.unit}</h2>
        <p>{order.address}</p>
      </section>

      {existing && previewUrl ? (
        <section className="signature-existing-card">
          <div>
            <span><Icon name="signature" size={17} /> 已签字</span>
            <b>{existing.signerName}</b>
            <small>{formatDateTime(existing.signedAt)} · 本地离线记录</small>
          </div>
          <img src={previewUrl} alt={`${existing.signerName}的签字`} />
        </section>
      ) : null}

      <section className="signature-form-card" aria-busy={loading || saving}>
        <label className="signature-name-field">
          <span>签字人姓名</span>
          <input
            value={signerName}
            maxLength={40}
            disabled={!accountKey || saving}
            onChange={(event) => setSignerName(event.target.value)}
            placeholder="请输入签字人姓名"
          />
        </label>
        <div className="signature-launch-heading">
          <div><span>手写签字</span><small>签字时将打开横向全屏画布</small></div>
          {draftBlob ? <em><Icon name="check" size={13} /> 已完成</em> : null}
        </div>
        {draftBlob && draftPreviewUrl ? (
          <div className="signature-draft-preview">
            <img src={draftPreviewUrl} alt="本次手写签字预览" />
          </div>
        ) : null}
        <button
          type="button"
          className="signature-launch-button"
          disabled={!accountKey || saving}
          onClick={openSignaturePad}
        >
          <Icon name="signature" size={19} />
          <span><b>{draftBlob ? "重新横屏签字" : "进入横向全屏签字"}</b><small>横握手机，在完整画布内书写</small></span>
          <Icon name="chevron" size={17} />
        </button>
        <p className="signature-offline-note">
          <Icon name="database" size={15} /> 签字只保存在当前账号的本机数据库，不上传服务器，也不计入统计。
        </p>
        {message ? <p className="signature-message" role="status" aria-live="polite">{message}</p> : null}
        <div className="signature-actions">
          {existing ? <button type="button" className="signature-delete" disabled={saving} onClick={() => void remove()}>删除记录</button> : null}
          <button type="button" className="primary-button" disabled={!accountKey || loading || saving} onClick={() => void save()}>
            {saving ? "正在保存…" : existing ? "更新签字" : "确认保存签字"}
          </button>
        </div>
      </section>
      {signaturePadOpen ? (
        <div className="signature-landscape-overlay" role="dialog" aria-modal="true" aria-label="横向全屏签字">
          <div className="signature-landscape-secondary-actions">
            <button type="button" onClick={closeSignaturePad}>取消</button>
            <button type="button" disabled={!hasInk} onClick={initializeCanvas}>清空</button>
          </div>
          <button
            type="button"
            className="signature-landscape-confirm"
            disabled={!hasInk}
            onClick={() => void acceptSignature()}
          >
            <Icon name="check" size={14} />
            确认
          </button>
          <div className="signature-landscape-canvas-shell">
            <canvas
              ref={canvasRef}
              aria-label="横向全屏手写签字区域"
              onPointerDown={begin}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={finish}
            />
            {!hasInk ? <span>请在空白区域签字</span> : null}
            <small>
              {order.woNumber || order.id} · 签字人：{signerName.trim() || "请返回填写姓名"}
            </small>
          </div>
          {message ? <p className="signature-landscape-message">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
