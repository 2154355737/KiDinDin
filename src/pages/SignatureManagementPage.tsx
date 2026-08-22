import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import {
  deleteSignatureRecord,
  listSignatureRecords,
  type SignatureRecord,
} from "../services/signatureStore";

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

function SignaturePreview({ record }: { record: SignatureRecord }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(record.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [record.blob]);
  return url ? <img src={url} alt={`${record.signerName}的签字`} /> : null;
}

export function SignatureManagementPage({
  accountKey,
  onBack,
  onSignatureChange,
}: {
  accountKey: string | null;
  onBack: () => void;
  onSignatureChange: (woHeaderId: string, saved: boolean) => void;
}) {
  const [records, setRecords] = useState<SignatureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage("");
    if (!accountKey) {
      setRecords([]);
      setLoading(false);
      setMessage("当前登录缺少本地账号标识，无法读取签字记录");
      return;
    }
    try {
      setRecords(await listSignatureRecords(accountKey));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取签字记录失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accountKey]);

  useEffect(() => {
    const back = (event: Event) => {
      event.preventDefault();
      onBack();
    };
    window.addEventListener("kidindin:back", back);
    return () => window.removeEventListener("kidindin:back", back);
  }, [onBack]);

  const visibleRecords = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return records;
    return records.filter((record) =>
      [record.woNumber, record.signerName, record.resident, record.unit, record.address]
        .some((value) => value.toLocaleLowerCase().includes(keyword)),
    );
  }, [query, records]);

  const remove = async (record: SignatureRecord) => {
    if (!accountKey || !window.confirm(`确定删除 ${record.woNumber} 的本地签字吗？`)) return;
    setMessage("");
    try {
      await deleteSignatureRecord(accountKey, record.woHeaderId);
      setRecords((current) => current.filter((item) => item.woHeaderId !== record.woHeaderId));
      setExpandedId((current) => current === record.woHeaderId ? null : current);
      onSignatureChange(record.woHeaderId, false);
      setMessage("本地签字记录已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除签字记录失败");
    }
  };

  return (
    <div className="signature-management-page">
      <header className="subheader signature-header">
        <button type="button" className="back-button" onClick={onBack} aria-label="返回"><Icon name="chevron" /></button>
        <h1>签字管理</h1>
        <button type="button" className={`icon-button ${loading ? "loading" : ""}`} disabled={loading} onClick={() => void load()} aria-label="刷新签字记录"><Icon name="refresh" size={18} /></button>
      </header>

      <section className="signature-management-summary">
        <div><span>本机签字</span><b>{records.length}</b></div>
        <p><Icon name="database" size={16} /> 当前账号独立保存，不参与首页统计与业务状态</p>
      </section>

      <label className="signature-search">
        <Icon name="search" size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工单、姓名或地址" />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label="清除搜索"><Icon name="close" size={15} /></button> : null}
      </label>

      {message ? <p className="signature-message" role="status" aria-live="polite">{message}</p> : null}
      <section className="signature-record-list" aria-busy={loading}>
        {visibleRecords.map((record) => {
          const expanded = expandedId === record.woHeaderId;
          return (
            <article key={record.key} className={expanded ? "expanded" : ""}>
              <button type="button" className="signature-record-main" onClick={() => setExpandedId(expanded ? null : record.woHeaderId)}>
                <span className="signature-record-icon"><Icon name="signature" size={20} /></span>
                <span className="signature-record-copy">
                  <span><b>{record.signerName}</b><em>已签字</em></span>
                  <strong>{record.resident} · {record.unit}</strong>
                  <small>{record.woNumber} · {formatDateTime(record.signedAt)}</small>
                </span>
                <Icon name="chevron" size={17} />
              </button>
              {expanded ? (
                <div className="signature-record-detail">
                  <SignaturePreview record={record} />
                  <p>{record.address}</p>
                  <button type="button" onClick={() => void remove(record)}><Icon name="trash" size={15} />删除本地记录</button>
                </div>
              ) : null}
            </article>
          );
        })}
        {!loading && visibleRecords.length === 0 ? (
          <div className="signature-empty">
            <Icon name="signature" size={30} />
            <b>{records.length ? "没有匹配的签字记录" : "还没有签字记录"}</b>
            <span>请从工单详情进入签字页，保存后会显示在这里。</span>
          </div>
        ) : null}
        {loading ? <div className="signature-empty"><Icon name="refresh" size={24} /><b>正在读取本机签字…</b></div> : null}
      </section>
    </div>
  );
}
