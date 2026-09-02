import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import {
  checkPermissions as checkBarcodePermissions,
  Format as BarcodeFormat,
  requestPermissions as requestBarcodePermissions,
  scan as scanBarcode,
} from "@tauri-apps/plugin-barcode-scanner";
import { Icon } from "../components/Icon";
import type { LocalWorkOrderMeta } from "../services/localWorkOrderStore";
import { getEmployeeBadgeCode, saveEmployeeBadgeCode } from "../services/employeeBadgeStore";
import { fetchDevicePower } from "../services/workOrderApi";
import { isNativeRuntime } from "../services/tauri";

export type MorePageProps = {
  items: LocalWorkOrderMeta[];
  accountKey: string | null;
  busy?: boolean;
  message?: string;
  onOpenBatchSubmit: () => void;
  onOpenAllWorkOrders: () => void;
  onOpenResidentSecurityPrefill: () => void;
  onOpenDailyBatchPrefill: () => void;
  onOpenVacantRoomFill: () => void;
  onOpenVacantRoom: () => void;
  onOpenLogAudit: () => void;
  onOpenSaved: () => void;
  onOpenAppointments: () => void;
  onOpenBackupRestore: () => void;
  onOpenSettings: () => void;
  onOpenVisitVerify: () => void;
  onOpenImageEncoding: () => void;
  onOpenSignatureManagement: () => void;
  showToolDescriptions?: boolean;
  onExportLocalData: () => void | Promise<void>;
  onImportLocalData: (json: string, fileName: string) => void | Promise<void>;
  onClearLocalData: () => void | Promise<void>;
};

export function MorePage({
  items,
  accountKey,
  busy = false,
  message = "",
  onOpenBatchSubmit,
  onOpenAllWorkOrders,
  onOpenResidentSecurityPrefill,
  onOpenDailyBatchPrefill,
  onOpenVacantRoomFill,
  onOpenVacantRoom,
  onOpenLogAudit,
  onOpenSaved,
  onOpenAppointments,
  onOpenBackupRestore,
  onOpenSettings,
  onOpenVisitVerify,
  onOpenImageEncoding,
  onOpenSignatureManagement,
  showToolDescriptions = true,
  onExportLocalData,
  onImportLocalData,
  onClearLocalData,
}: MorePageProps) {
  const importInput = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState("");
  const [badgeCode, setBadgeCode] = useState(() => getEmployeeBadgeCode(accountKey));
  const [badgeDialogOpen, setBadgeDialogOpen] = useState(false);
  const [badgeQrValue, setBadgeQrValue] = useState("");
  const [badgeScanning, setBadgeScanning] = useState(false);
  const [badgeMessage, setBadgeMessage] = useState("");
  const [powerWarning, setPowerWarning] = useState("");
  const counts = useMemo(() => ({
    appointments: items.filter((item) => Boolean(item.appointmentAt)).length,
    favorites: items.filter((item) => item.favorite).length,
    pinned: items.filter((item) => item.pinned).length,
  }), [items]);

  useEffect(() => {
    setBadgeCode(getEmployeeBadgeCode(accountKey));
    setPowerWarning("");
  }, [accountKey]);

  useEffect(() => {
    if (!badgeCode) return;
    let active = true;
    const checkPower = async () => {
      try {
        const data = await fetchDevicePower(badgeCode);
        const powerData = data && typeof data === "object" ? data as Record<string, unknown> : null;
        const records = powerData?.records;
        const low = Array.isArray(data)
          ? data.length > 0
          : Boolean(powerData && (
            (Array.isArray(records) && records.length > 0) ||
            powerData.lowPower === true ||
            powerData.isLowPower === true
          ));
        if (active) setPowerWarning(low ? "电子工牌电量偏低，请及时充电" : "");
      } catch { /* 电量查询失败不影响其他功能，下次进入更多页时重试。 */ }
    };
    void checkPower();
    const timer = window.setInterval(() => void checkPower(), 5 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [badgeCode]);

  const scanBadgeQrCode = async () => {
    if (badgeScanning) return;
    if (!isNativeRuntime()) {
      setBadgeMessage("摄像头扫码仅支持 KiDinDin 安卓应用，请在下方粘贴工牌二维码内容");
      return;
    }
    setBadgeScanning(true);
    setBadgeMessage("正在打开摄像头，请将电子工牌二维码放入取景框…");
    try {
      let permission = await checkBarcodePermissions();
      if (permission !== "granted") permission = await requestBarcodePermissions();
      if (permission !== "granted") throw new Error("未获得摄像头权限，请在系统设置中允许 KiDinDin 使用摄像头");
      const result = await scanBarcode({ cameraDirection: "back", formats: [BarcodeFormat.QRCode], windowed: false });
      const value = result.content.trim();
      if (!value) throw new Error("没有识别到有效的工牌二维码");
      setBadgeQrValue(value);
      setBadgeMessage("工牌二维码已识别，确认后仅保存到本机");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBadgeMessage(/cancel|canceled|cancelled|取消/i.test(message) ? "已取消扫码，未保存工牌绑定" : message || "工牌二维码识别失败");
    } finally { setBadgeScanning(false); }
  };

  const saveBadgeBinding = () => {
    if (!accountKey) return;
    try {
      setBadgeCode(saveEmployeeBadgeCode(accountKey, badgeQrValue));
      setBadgeDialogOpen(false);
      setBadgeQrValue("");
      setBadgeMessage("工牌码已绑定到本机");
    } catch (error) { setBadgeMessage(error instanceof Error ? error.message : "保存工牌绑定失败"); }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImportMessage("");
    try {
      const content = await file.text();
      JSON.parse(content);
      await onImportLocalData(content, file.name);
    } catch (error) {
      setImportMessage(error instanceof Error ? `导入失败：${error.message}` : "导入失败：文件内容无效");
    } finally {
      input.value = "";
    }
  };

  return <>
    <header className="topbar more-page-header">
      <div><h1>更多功能</h1></div>
    </header>

    <section className="more-page-summary" aria-label="本地工单概览">
      <div><span>收藏</span><b>{counts.favorites}</b></div>
      <div><span>置顶</span><b>{counts.pinned}</b></div>
      <div><span>预约</span><b>{counts.appointments}</b></div>
    </section>

    <section className="more-page-section">
      <div className="more-section-heading"><h2>工单工具</h2></div>
      <div className={`more-tool-grid ${showToolDescriptions ? "" : "hide-descriptions"}`}>
        <button type="button" className="more-feature-card" disabled={!accountKey} onClick={() => {
          setBadgeQrValue("");
          setBadgeMessage(badgeCode ? "当前工牌已绑定；如需更换可重新扫码确认" : "请扫描电子工牌二维码完成一次绑定");
          setBadgeDialogOpen(true);
        }}>
          <span className="more-feature-icon"><Icon name="badge" size={21} /></span>
          <span className="more-feature-copy"><b>工牌码绑定</b><small>{badgeCode ? `当前：${badgeCode}` : "扫码绑定一次，用于电子工牌"}</small></span>
          <Icon name={badgeCode ? "check" : "chevron"} size={18} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenAllWorkOrders}>
          <span className="more-feature-icon"><Icon name="search" size={21} /></span>
          <span className="more-feature-copy"><b>全部工单</b><small>跨日期、状态和类型搜索筛选</small></span>
          <Icon name="chevron" size={18} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenVacantRoomFill}>
          <span className="more-feature-icon"><Icon name="note" size={21} /></span>
          <span className="more-feature-copy"><b>空房填单</b><small>检查后批量预存安检选项</small></span>
          <Icon name="chevron" size={18} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenResidentSecurityPrefill}>
          <span className="more-feature-icon"><Icon name="audit" size={21} /></span>
          <span className="more-feature-copy"><b>安检预填</b><small>复用上一年居民安检选项及批准文本</small></span>
          <Icon name="chevron" size={18} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenDailyBatchPrefill}>
          <span className="more-feature-icon"><Icon name="tasks" size={21} /></span>
          <span className="more-feature-copy"><b>当天工单一键预填</b><small>批量预存当天所有居民安检工单</small></span>
          <Icon name="chevron" size={18} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenVacantRoom}>
          <span className="more-feature-icon"><Icon name="download" size={21} /></span>
          <span className="more-feature-copy"><b>空房取单</b><small>批量提取上一次安检工单照片</small></span>
          <Icon name="chevron" size={18} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenBatchSubmit}>
          <span className="more-feature-icon"><Icon name="tasks" size={21} /></span>
          <span className="more-feature-copy"><b>批量提交</b><small>批量处理已准备工单</small></span>
          <Icon name="chevron" size={18} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenLogAudit}>
          <span className="more-feature-icon"><Icon name="audit" size={20} /></span>
          <span className="more-feature-copy"><b>流转审核</b><small>检查关闭工单流转结果</small></span>
          <Icon name="chevron" size={17} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenSaved}>
          <span className="more-feature-icon"><Icon name="star" size={20} /></span>
          <span className="more-feature-copy"><b>我的工单</b><small>查看收藏、置顶与本地工单</small></span>
          <Icon name="chevron" size={17} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenAppointments}>
          <span className="more-feature-icon"><Icon name="appointment" size={20} /></span>
          <span className="more-feature-copy"><b>预约日程</b><small>集中查看工单预约时间</small></span>
          <Icon name="chevron" size={17} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenVisitVerify}>
          <span className="more-feature-icon"><Icon name="check" size={20} /></span>
          <span className="more-feature-copy"><b>到访验证</b><small>手动上传图片验证增广效果</small></span>
          <Icon name="chevron" size={17} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenImageEncoding}>
          <span className="more-feature-icon"><Icon name="database" size={20} /></span>
          <span className="more-feature-copy"><b>图片编码记录</b><small>查看编码使用状态与本地预览</small></span>
          <Icon name="chevron" size={17} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenSignatureManagement}>
          <span className="more-feature-icon"><Icon name="signature" size={20} /></span>
          <span className="more-feature-copy"><b>签字管理</b><small>查看和管理本机工单签字记录</small></span>
          <Icon name="chevron" size={17} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenBackupRestore}>
          <span className="more-feature-icon"><Icon name="database" size={20} /></span>
          <span className="more-feature-copy"><b>备份与恢复</b><small>流式备份数 GB 图片、WebDB 与 SQLite</small></span>
          <Icon name="chevron" size={17} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenSettings}>
          <span className="more-feature-icon"><Icon name="settings" size={20} /></span>
          <span className="more-feature-copy"><b>完整设置</b><small>外观、工具偏好与高级配置</small></span>
          <Icon name="chevron" size={17} />
        </button>
      </div>
      {powerWarning ? <p className="more-badge-warning" role="status">{powerWarning}</p> : null}
    </section>

    <section className="more-page-section local-data-section">
      <div className="more-section-heading"><h2>当前账号工单资料</h2></div>
      <div className="local-data-actions">
        <button type="button" disabled={busy} onClick={() => void onExportLocalData()}>
          <Icon name="download" size={18} /><span><b>导出工单</b></span>
        </button>
        <button type="button" disabled={busy} onClick={() => importInput.current?.click()}>
          <Icon name="upload" size={18} /><span><b>导入工单</b></span>
        </button>
        <button type="button" className="local-data-clear" disabled={busy || items.length === 0} onClick={() => void onClearLocalData()}>
          <Icon name="trash" size={18} /><span><b>清空工单</b></span>
        </button>
      </div>
      <input ref={importInput} className="local-data-file-input" type="file" accept="application/json,.json" hidden onChange={(event) => void handleImport(event)} />
      {message || importMessage ? <p className="local-data-message" role="status" aria-live="polite">{message || importMessage}</p> : null}
    </section>
    {badgeDialogOpen && createPortal(
      <div className="retry-confirm-backdrop" onClick={() => !badgeScanning && setBadgeDialogOpen(false)}>
        <section className="retry-confirm-dialog badge-dialog" role="dialog" aria-modal="true" aria-label="工牌码绑定" onClick={(event) => event.stopPropagation()}>
          <h3>绑定电子工牌码</h3><p>二维码内容仅保存到当前账号的本机。</p>
          {badgeCode ? <div className="badge-current-code"><span>当前工牌码</span><b>{badgeCode}</b></div> : null}
          <button type="button" className="one-standard-image-picker" disabled={badgeScanning} onClick={() => void scanBadgeQrCode()}><Icon name="scan" size={18} /><span><b>{badgeScanning ? "正在扫描…" : "打开摄像头扫描工牌码"}</b><small>仅识别二维码；扫码后仍需确认保存</small></span></button>
          <label className="one-standard-qr-input"><span>工牌二维码内容</span><textarea value={badgeQrValue} placeholder="摄像头扫码后自动填写，也可以粘贴工牌二维码内容" onChange={(event) => setBadgeQrValue(event.target.value)} /></label>
          {badgeMessage ? <p className="one-standard-dialog-message" role="status">{badgeMessage}</p> : null}
          <div className="retry-confirm-actions"><button type="button" disabled={badgeScanning} onClick={() => setBadgeDialogOpen(false)}>取消</button><button type="button" disabled={!badgeQrValue.trim() || badgeScanning} onClick={saveBadgeBinding}>确认绑定</button></div>
        </section>
      </div>, document.body,
    )}
  </>;
}
