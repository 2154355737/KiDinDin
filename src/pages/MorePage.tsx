import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "../components/Icon";
import type { LocalWorkOrderMeta } from "../services/localWorkOrderStore";

export type MorePageProps = {
  items: LocalWorkOrderMeta[];
  busy?: boolean;
  message?: string;
  onOpenBatchSubmit: () => void;
  onOpenSaved: () => void;
  onOpenAppointments: () => void;
  onExportLocalData: () => void | Promise<void>;
  onImportLocalData: (json: string, fileName: string) => void | Promise<void>;
  onClearLocalData: () => void | Promise<void>;
};

export function MorePage({
  items,
  busy = false,
  message = "",
  onOpenBatchSubmit,
  onOpenSaved,
  onOpenAppointments,
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
      <div><p className="eyebrow">本机工作台</p><h1>更多功能</h1></div>
      <span className="more-local-badge">仅保存在本机</span>
    </header>

    <section className="more-page-summary" aria-label="本地工单概览">
      <div><span>收藏</span><b>{counts.favorites}</b></div>
      <div><span>置顶</span><b>{counts.pinned}</b></div>
      <div><span>预约</span><b>{counts.appointments}</b></div>
    </section>

    <section className="more-page-section">
      <div className="more-section-heading"><h2>工单工具</h2><p>批量处理与个人工单标记</p></div>
      <button type="button" className="more-feature-card more-feature-primary" onClick={onOpenBatchSubmit}>
        <span className="more-feature-icon"><Icon name="tasks" size={21} /></span>
        <span className="more-feature-copy"><b>批量提交</b><small>使用现有流程批量处理到访不遇工单</small></span>
        <Icon name="chevron" size={18} />
      </button>
      <div className="more-feature-grid">
        <button type="button" className="more-feature-card" onClick={onOpenSaved}>
          <span className="more-feature-icon"><Icon name="star" size={20} /></span>
          <span className="more-feature-copy"><b>我的工单</b><small>{counts.favorites} 收藏 · {counts.pinned} 置顶</small></span>
          <Icon name="chevron" size={17} />
        </button>
        <button type="button" className="more-feature-card" onClick={onOpenAppointments}>
          <span className="more-feature-icon"><Icon name="appointment" size={20} /></span>
          <span className="more-feature-copy"><b>预约日程</b><small>{counts.appointments ? `${counts.appointments} 个预约待跟进` : "暂无预约"}</small></span>
          <Icon name="chevron" size={17} />
        </button>
      </div>
    </section>

    <section className="more-page-section local-data-section">
      <div className="more-section-heading"><h2>本地数据</h2><p>标记不会同步到其他设备，建议定期导出备份</p></div>
      <div className="local-data-actions">
        <button type="button" disabled={busy} onClick={() => void onExportLocalData()}>
          <Icon name="download" size={18} /><span><b>导出数据</b><small>保存 JSON 备份</small></span>
        </button>
        <button type="button" disabled={busy} onClick={() => importInput.current?.click()}>
          <Icon name="upload" size={18} /><span><b>导入数据</b><small>读取 UTF-8 JSON</small></span>
        </button>
        <button type="button" className="local-data-clear" disabled={busy || items.length === 0} onClick={() => void onClearLocalData()}>
          <Icon name="trash" size={18} /><span><b>清空数据</b><small>删除全部本地标记</small></span>
        </button>
      </div>
      <input ref={importInput} className="local-data-file-input" type="file" accept="application/json,.json" hidden onChange={(event) => void handleImport(event)} />
      {message || importMessage ? <p className="local-data-message" role="status" aria-live="polite">{message || importMessage}</p> : null}
    </section>
  </>;
}
