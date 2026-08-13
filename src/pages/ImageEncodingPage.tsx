import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "../components/Icon";
import {
  listUsedUploadFileNames,
  updateUploadFileNamePreview,
  type UploadFileNameStatus,
  type UsedUploadFileName,
} from "../services/uploadFileNameStore";

type StatusFilter = "all" | UploadFileNameStatus;

const statusLabels: Record<UploadFileNameStatus, string> = {
  reserved: "已生成",
  uploaded: "已上传",
  failed: "上传失败",
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatFileSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "未知大小";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function readPreview(file: File) {
  return new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxEdge = 360;
      const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("无法创建图片预览"));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("选择的文件不是可预览图片"));
    };
    image.src = objectUrl;
  });
}

export function ImageEncodingPage({ onBack }: { onBack: () => void }) {
  const previewInput = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<UsedUploadFileName[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draftPreview, setDraftPreview] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");

  const loadRecords = async () => {
    setLoading(true);
    setMessage("");
    try {
      const next = await listUsedUploadFileNames();
      setRecords(next);
      setSelectedName((current) => current && next.some((item) => item.name === current) ? current : null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取图片编码记录失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRecords();
  }, []);

  const selected = records.find((record) => record.name === selectedName) ?? null;
  const todayKey = new Date().toLocaleDateString("zh-CN");
  const stats = useMemo(() => ({
    total: records.length,
    uploaded: records.filter((item) => item.status === "uploaded").length,
    failed: records.filter((item) => item.status === "failed").length,
    today: records.filter((item) => new Date(item.generatedAt).toLocaleDateString("zh-CN") === todayKey).length,
  }), [records, todayKey]);
  const visibleRecords = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return records.filter((record) => {
      if (filter !== "all" && record.status !== filter) return false;
      if (!keyword) return true;
      return [record.name, record.sourceName, record.note, record.failureMessage]
        .some((value) => value?.toLocaleLowerCase().includes(keyword));
    });
  }, [filter, query, records]);

  const openEditor = (record: UsedUploadFileName) => {
    setSelectedName(record.name);
    setDraftPreview(record.previewDataUrl);
    setDraftNote(record.note);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pickPreview = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setMessage("");
    try {
      setDraftPreview(await readPreview(file));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片预览读取失败");
    }
  };

  const savePreview = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setMessage("");
    try {
      await updateUploadFileNamePreview(selected.name, draftPreview, draftNote);
      await loadRecords();
      setMessage("本地预览数据已保存，服务器图片与编码未更改");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存本地预览数据失败");
    } finally {
      setSaving(false);
    }
  };

  return <div className="image-encoding-page">
    <header className="subheader image-encoding-header">
      <button type="button" className="back-button" onClick={onBack} aria-label="返回"><Icon name="chevron" /></button>
      <h1>图片编码记录</h1>
      <button type="button" className={`icon-button ${loading ? "loading" : ""}`} disabled={loading} onClick={() => void loadRecords()} aria-label="刷新编码记录"><Icon name="refresh" size={18} /></button>
    </header>

    <section className="encoding-summary" aria-label="编码使用概览">
      <div><span>全部编码</span><b>{stats.total}</b></div>
      <div><span>已上传</span><b>{stats.uploaded}</b></div>
      <div><span>今日生成</span><b>{stats.today}</b></div>
      <div><span>失败记录</span><b className={stats.failed ? "danger" : ""}>{stats.failed}</b></div>
    </section>

    <section className="encoding-rule-card">
      <span className="encoding-rule-icon"><Icon name="database" size={21} /></span>
      <div><b>跨日期永久去重库</b><code>IMG_YYYY + 6位随机码 + MM + 3位随机码 + DD.jpg</code><small>编码记录不可删除或改名，防止未来重新使用。预览与备注仅保存在本机。</small></div>
    </section>

    {selected ? <section className="encoding-editor">
      <div className="encoding-editor-heading"><div><span>编辑本地预览</span><code>{selected.name}</code></div><button type="button" onClick={() => setSelectedName(null)} aria-label="关闭编辑"><Icon name="close" size={18} /></button></div>
      <div className="encoding-preview-editor">
        <div className="encoding-preview-frame">{draftPreview ? <img src={draftPreview} alt={`${selected.name} 本地预览`} /> : <span><Icon name="note" size={25} />暂无预览</span>}</div>
        <div className="encoding-preview-actions">
          <button type="button" onClick={() => previewInput.current?.click()}><Icon name="upload" size={16} />更换预览</button>
          <button type="button" disabled={!draftPreview} onClick={() => setDraftPreview(null)}><Icon name="trash" size={16} />移除预览</button>
        </div>
      </div>
      <label className="encoding-note-field"><span>本地备注</span><textarea maxLength={200} value={draftNote} onChange={(event) => setDraftNote(event.target.value)} placeholder="可记录图片用途、工单或现场说明" /><small>{draftNote.length}/200</small></label>
      <p>这里只更改 IndexedDB 中的预览和备注，不会修改已经上传的图片、服务器附件或编码。</p>
      <button type="button" className="primary-button encoding-save" disabled={saving} onClick={() => void savePreview()}>{saving ? "正在保存…" : "保存本地预览数据"}</button>
      <input ref={previewInput} hidden type="file" accept="image/*" onChange={(event) => void pickPreview(event)} />
    </section> : null}

    <section className="encoding-controls">
      <label><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索编码、原文件名或备注" /></label>
      <div className="encoding-filter-row">
        {(["all", "uploaded", "reserved", "failed"] as StatusFilter[]).map((value) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "全部" : statusLabels[value]}</button>)}
      </div>
    </section>

    {message ? <p className="encoding-message" role="status" aria-live="polite">{message}</p> : null}
    <section className="encoding-record-list" aria-busy={loading}>
      {visibleRecords.map((record) => <article key={record.name} className={selectedName === record.name ? "selected" : ""}>
        <div className="encoding-record-preview">{record.previewDataUrl ? <img src={record.previewDataUrl} alt="" /> : <Icon name="note" size={21} />}</div>
        <div className="encoding-record-main">
          <div><code>{record.name}</code><span className={`encoding-status ${record.status}`}>{statusLabels[record.status]}</span></div>
          <b>{record.sourceName || "未知原文件名"}</b>
          <small>{formatDateTime(record.generatedAt)} · {formatFileSize(record.sourceSize)}</small>
          {record.note ? <p>{record.note}</p> : null}
          {record.failureMessage ? <em>{record.failureMessage}</em> : null}
        </div>
        <button type="button" className="encoding-edit-button" onClick={() => openEditor(record)}>预览/编辑</button>
      </article>)}
      {!loading && visibleRecords.length === 0 ? <div className="encoding-empty"><Icon name="database" size={28} /><b>{records.length ? "没有符合条件的编码" : "还没有图片编码记录"}</b><span>开始上传图片后，编码和本地预览会自动记录在这里。</span></div> : null}
      {loading ? <div className="encoding-empty"><Icon name="refresh" size={24} /><b>正在读取本地编码库…</b></div> : null}
    </section>
  </div>;
}
