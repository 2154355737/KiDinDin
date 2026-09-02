import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "../components/Icon";
import type { LocalWorkOrderMeta } from "../services/localWorkOrderStore";

export type MorePageProps = {
  items: LocalWorkOrderMeta[];
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
  const counts = useMemo(() => ({
    appointments: items.filter((item) => Boolean(item.appointmentAt)).length,
    favorites: items.filter((item) => item.favorite).length,
    pinned: items.filter((item) => item.pinned).length,
  }), [items]);

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
  </>;
}
