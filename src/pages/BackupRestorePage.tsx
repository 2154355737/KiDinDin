import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "../components/Icon";
import {
  exportCompleteBackup,
  inspectCompleteBackupFile,
  restoreCompleteBackupFile,
  type BackupArchiveInspection,
  type BackupArchiveProgress,
} from "../services/backupArchive";

export type BackupRestorePageProps = {
  accountKey: string | null;
  accountLabel: string;
  onBack: () => void;
};

type ActiveOperation = "export" | "inspect" | "restore";
type Notice = { kind: "info" | "success" | "warning" | "error"; text: string };

const phaseLabels: Record<BackupArchiveProgress["phase"], string> = {
  preparing: "准备备份",
  exporting: "正在导出",
  reading: "正在读取",
  validating: "正在校验",
  staging: "准备恢复",
  restoring: "正在恢复",
  finalizing: "正在收尾",
  "rolling-back": "正在回滚",
  completed: "处理完成",
};

function formatBytes(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return "待计算";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function progressPercentage(progress: BackupArchiveProgress | null) {
  if (!progress) return null;
  if (progress.phase === "completed") return 100;
  if (progress.totalBytes !== null && progress.totalBytes > 0) {
    return Math.max(0, Math.min(100, Math.round((progress.processedBytes / progress.totalBytes) * 100)));
  }
  if (progress.totalRecords !== null && progress.totalRecords > 0) {
    return Math.max(0, Math.min(100, Math.round((progress.processedRecords / progress.totalRecords) * 100)));
  }
  if (progress.totalBytes === 0 && progress.totalRecords === 0) return 100;
  return null;
}

function formatRecordProgress(progress: BackupArchiveProgress) {
  const processed = Math.max(0, Math.trunc(progress.processedRecords));
  return progress.totalRecords === null
    ? `已处理 ${processed.toLocaleString("zh-CN")} 条记录 / 总数待计算`
    : `已处理 ${processed.toLocaleString("zh-CN")} / ${Math.max(0, Math.trunc(progress.totalRecords)).toLocaleString("zh-CN")} 条记录`;
}

function rollbackNotice(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const rolledBack = (result as { rolledBack?: unknown }).rolledBack;
  if (!rolledBack) return null;
  if (typeof rolledBack === "string" && rolledBack.trim()) return rolledBack.trim();
  if (typeof rolledBack === "object") {
    const message = (rolledBack as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "服务报告本次恢复未完成，已执行回滚；备份数据没有作为成功结果应用。";
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return null;
}

function inspectionFormatLabel(format: BackupArchiveInspection["format"]) {
  return format === "archive" ? "新流式完整备份" : "旧版 JSON 完整备份";
}

export function BackupRestorePage({ accountKey, accountLabel, onBack }: BackupRestorePageProps) {
  const importInput = useRef<HTMLInputElement>(null);
  const operationLock = useRef(false);
  const operationSequence = useRef(0);
  const mounted = useRef(true);
  const [activeOperation, setActiveOperation] = useState<ActiveOperation | null>(null);
  const [progress, setProgress] = useState<BackupArchiveProgress | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<BackupArchiveInspection | null>(null);
  const [notice, setNotice] = useState<Notice>({
    kind: "info",
    text: "可导出全部本地数据，或选择新流式备份及旧版 JSON 完整备份进行检查。",
  });

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const beginOperation = (operation: ActiveOperation) => {
    if (operationLock.current) return null;
    operationLock.current = true;
    operationSequence.current += 1;
    setActiveOperation(operation);
    setProgress(null);
    return operationSequence.current;
  };

  const endOperation = (sequence: number) => {
    if (sequence !== operationSequence.current) return;
    operationLock.current = false;
    if (mounted.current) setActiveOperation(null);
  };

  const handleProgress = (sequence: number) => (next: BackupArchiveProgress) => {
    if (!mounted.current || !operationLock.current || sequence !== operationSequence.current) return;
    setProgress({ ...next });
  };

  const showCompletedProgress = (
    sequence: number,
    message: string,
    processedBytes: number,
    processedRecords: number,
  ) => {
    if (!mounted.current || sequence !== operationSequence.current) return;
    setProgress({
      phase: "completed",
      message,
      processedBytes,
      totalBytes: processedBytes,
      processedRecords,
      totalRecords: processedRecords,
    });
  };

  const handleExport = async () => {
    const sequence = beginOperation("export");
    if (sequence === null) return;
    setNotice({ kind: "info", text: "正在准备完整备份，请保持应用在前台并等待保存结果。" });
    try {
      const result = await exportCompleteBackup({
        activeAccountKey: accountKey,
        activeAccountLabel: accountLabel,
        onProgress: handleProgress(sequence),
      });
      const recordCount = result.indexedDbRecordCount + result.nativeSqliteRecordCount + result.localStorageEntryCount;
      showCompletedProgress(sequence, "完整备份导出完成", result.size, recordCount);
      setNotice({
        kind: "success",
        text: result.method === "native"
          ? `完整备份已写入 ${result.destination}：${result.fileName}（${formatBytes(result.size)}，${result.databaseCount} 个 WebDB、${result.indexedDbRecordCount.toLocaleString("zh-CN")} 条 WebDB 记录、${result.nativeSqliteRecordCount.toLocaleString("zh-CN")} 条 SQLite 记录、${result.localStorageEntryCount.toLocaleString("zh-CN")} 项偏好）`
          : `完整备份已发起浏览器下载：${result.fileName}（${formatBytes(result.size)}，${result.databaseCount} 个 WebDB、${result.indexedDbRecordCount.toLocaleString("zh-CN")} 条 WebDB 记录、${result.nativeSqliteRecordCount.toLocaleString("zh-CN")} 条 SQLite 记录、${result.localStorageEntryCount.toLocaleString("zh-CN")} 项偏好）`,
      });
    } catch (error) {
      const reason = readErrorMessage(error);
      setNotice({
        kind: "error",
        text: reason ? `完整备份导出失败：${reason}` : "完整备份导出失败",
      });
    } finally {
      endOperation(sequence);
    }
  };

  const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;
    const sequence = beginOperation("inspect");
    if (sequence === null) return;
    setSelectedFile(null);
    setInspection(null);
    setNotice({ kind: "info", text: `正在只读检查 ${file.name}；检查完成前不会写入任何数据。` });
    try {
      const nextInspection = await inspectCompleteBackupFile(file, {
        onProgress: handleProgress(sequence),
      });
      const recordCount = nextInspection.indexedDbRecordCount +
        nextInspection.nativeSqliteRecordCount + nextInspection.localStorageEntryCount;
      setSelectedFile(file);
      setInspection(nextInspection);
      showCompletedProgress(sequence, "备份检查完成，等待确认恢复", file.size, recordCount);
      if (nextInspection.nativeSqlitePresent && !nextInspection.nativeSqliteCanRestore) {
        setNotice({
          kind: "error",
          text: `${file.name} 包含 Android SQLite 数据，但当前环境不能恢复 SQLite。为避免静默遗漏，已阻止恢复；请在 KiDinDin Android 应用中导入。检查阶段未写入数据。`,
        });
      } else {
        setNotice({
          kind: "success",
          text: `${file.name} 已通过只读检查。请核对下方数据范围，再确认恢复。`,
        });
      }
    } catch (error) {
      const reason = readErrorMessage(error);
      setNotice({
        kind: "error",
        text: reason
          ? `备份检查失败：${reason}。检查阶段未写入数据。`
          : "备份检查失败，检查阶段未写入数据。",
      });
    } finally {
      endOperation(sequence);
    }
  };

  const confirmAccountMapping = (preview: BackupArchiveInspection) => {
    const historyAccountKeysToMap = preview.historyAccountKeys.filter((key: string) => key !== accountKey);
    const sourceHistoryAccountKey =
      preview.sourceAccountKey?.startsWith("history:") && preview.sourceAccountKey !== accountKey
        ? preview.sourceAccountKey
        : null;

    if (historyAccountKeysToMap.length > 0 && !accountKey) {
      setNotice({
        kind: "error",
        text: "已阻止恢复：当前登录缺少可用的本地账号标识，无法安全映射来源设备的历史账号数据。未写入任何数据。",
      });
      return null;
    }

    const accountKeyMapping: Record<string, string> = {};
    let preservedHistoryAccountCount = 0;
    for (const accountKeyToMap of historyAccountKeysToMap) {
      const isSourceAccount = accountKeyToMap === sourceHistoryAccountKey;
      const sourceDescription = isSourceAccount && preview.sourceAccountLabel?.trim()
        ? `${preview.sourceAccountLabel}（${accountKeyToMap}）`
        : accountKeyToMap;
      const mappingConfirmed = window.confirm(
        `${isSourceAccount ? "备份来源账号" : "备份中的账号"} ${sourceDescription} 使用的是仅在原设备有效的历史标识。\n\n` +
        `是否将该标识下的 WebDB、SQLite 和账号偏好明确映射到当前账号 ${accountLabel}（${accountKey}）？\n\n` +
        (isSourceAccount
          ? "只有确认两者是同一账号时才应继续。"
          : "确认会把两者资料合并；取消只保留该账号原标识，不会取消其他资料的恢复。"),
      );
      if (!mappingConfirmed && isSourceAccount) {
        setNotice({ kind: "warning", text: "已取消账号映射和完整恢复，未写入数据。" });
        return null;
      }
      if (mappingConfirmed) accountKeyMapping[accountKeyToMap] = accountKey!;
      else preservedHistoryAccountCount += 1;
    }

    return { accountKeyMapping, preservedHistoryAccountCount };
  };

  const handleRestore = async () => {
    if (!selectedFile || !inspection) return;
    if (inspection.nativeSqlitePresent && !inspection.nativeSqliteCanRestore) {
      setNotice({
        kind: "error",
        text: "已阻止恢复：备份包含 Android SQLite 数据，但当前环境不能恢复 SQLite。未写入任何数据。",
      });
      return;
    }
    const sequence = beginOperation("restore");
    if (sequence === null) return;
    let restoreStarted = false;
    try {
      const confirmed = window.confirm(
        `将从 ${selectedFile.name} 合并恢复：\n` +
        `${inspection.databaseCount} 个 WebDB，共 ${inspection.indexedDbRecordCount.toLocaleString("zh-CN")} 条记录\n` +
        `${inspection.nativeSqlitePresent ? `Android SQLite ${inspection.nativeSqliteRecordCount.toLocaleString("zh-CN")} 条记录` : "未包含 Android SQLite"}\n` +
        `${inspection.localStorageEntryCount.toLocaleString("zh-CN")} 项应用偏好\n\n` +
        "同主键数据将按备份规则合并，不会删除本机额外记录，也不会恢复 Token、Cookie、Sign、密码或登录会话。是否继续？",
      );
      if (!confirmed) {
        setNotice({ kind: "warning", text: "已取消恢复，未写入任何数据。" });
        return;
      }

      const mapping = confirmAccountMapping(inspection);
      if (!mapping) return;
      setNotice({ kind: "info", text: "正在恢复完整备份。请勿关闭应用；如失败，将原样显示服务返回的回滚状态。" });
      restoreStarted = true;
      const result = await restoreCompleteBackupFile(selectedFile, {
        accountKeyMapping: Object.keys(mapping.accountKeyMapping).length
          ? mapping.accountKeyMapping
          : undefined,
        onProgress: handleProgress(sequence),
      });
      const rolledBack = rollbackNotice(result);
      if (rolledBack) {
        setNotice({ kind: "error", text: rolledBack });
        return;
      }
      if (result.nativeSqliteRecordCount > 0 && !result.nativeSqlite) {
        setNotice({
          kind: "error",
          text: "恢复服务已返回，但没有提供备份中 SQLite 数据的恢复结果，当前无法确认完整恢复。请先检查本机数据，不要直接重复导入。",
        });
        return;
      }

      const sqliteImported = (result.nativeSqlite?.workOrdersImported ?? 0) +
        (result.nativeSqlite?.prefillHistoryImported ?? 0);
      const sqliteText = result.nativeSqliteRecordCount === 0
        ? "SQLite 无记录"
        : result.nativeSqlite
          ? `SQLite 已检查 ${result.nativeSqliteRecordCount.toLocaleString("zh-CN")} 条、写入或更新 ${sqliteImported.toLocaleString("zh-CN")} 条`
          : "SQLite 未返回恢复统计";
      const recordCount = result.indexedDbRecordCount +
        result.nativeSqliteRecordCount + result.localStorageEntryCount;
      showCompletedProgress(sequence, "完整备份恢复完成", selectedFile.size, recordCount);
      setNotice({
        kind: "success",
        text: `完整备份恢复完成：${result.databaseCount} 个 WebDB 已合并检查 ${result.indexedDbRecordCount.toLocaleString("zh-CN")} 条，${sqliteText}，偏好 ${result.localStorageEntryCount.toLocaleString("zh-CN")} 项${mapping.preservedHistoryAccountCount ? `；${mapping.preservedHistoryAccountCount} 个其他账号标识按原值保留` : ""}。正在重新载入应用…`,
      });
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      const reason = readErrorMessage(error);
      setNotice({
        kind: "error",
        text: restoreStarted
          ? reason ?? "完整恢复失败；服务未返回可识别的失败与回滚信息。"
          : reason
            ? `恢复确认失败：${reason}。尚未写入数据。`
            : "恢复确认失败，尚未写入数据。",
      });
    } finally {
      endOperation(sequence);
    }
  };

  const busy = activeOperation !== null;
  const percentage = progressPercentage(progress);
  const canRestore = Boolean(
    selectedFile &&
    inspection &&
    (!inspection.nativeSqlitePresent || inspection.nativeSqliteCanRestore),
  );

  return (
    <div className="backup-restore-page" aria-busy={busy}>
      <header className="subheader backup-restore-header">
        <button
          type="button"
          className="back-button"
          disabled={busy}
          onClick={() => {
            if (!operationLock.current) onBack();
          }}
          aria-label={busy ? "备份操作进行中，暂时不能返回" : "返回"}
        >
          <Icon name="chevron" />
        </button>
        <div className="backup-restore-title">
          <small>本机完整数据</small>
          <h1>备份与恢复</h1>
        </div>
        <span className={`backup-restore-state ${busy ? "busy" : "idle"}`}>
          {busy ? "处理中" : "就绪"}
        </span>
      </header>

      <section className="backup-restore-account" aria-label="当前恢复账号">
        <span className="backup-restore-account-icon"><Icon name="database" size={21} /></span>
        <div>
          <small>当前账号</small>
          <b>{accountLabel || "未命名账号"}</b>
          <code>{accountKey ?? "缺少本地账号标识"}</code>
        </div>
      </section>

      <section className="backup-restore-actions" aria-label="备份操作">
        <button type="button" className="primary-button backup-export-button" disabled={busy} onClick={() => void handleExport()}>
          <Icon name="download" size={19} />
          <span>
            <b>{activeOperation === "export" ? "正在导出完整备份…" : "导出完整备份"}</b>
            <small>WebDB、图片与签字、应用偏好及 Android SQLite</small>
          </span>
        </button>
        <button type="button" className="backup-import-button" disabled={busy} onClick={() => importInput.current?.click()}>
          <Icon name="upload" size={19} />
          <span>
            <b>{activeOperation === "inspect" ? "正在检查备份…" : "选择备份文件"}</b>
            <small>支持新流式备份和旧版 JSON 完整备份</small>
          </span>
        </button>
        <input
          ref={importInput}
          hidden
          type="file"
          disabled={busy}
          aria-label="选择要检查和恢复的完整备份文件"
          onChange={(event) => void handleFileSelection(event)}
        />
      </section>

      {progress ? (
        <section className={`backup-progress-card phase-${progress.phase}`} aria-live="polite">
          <div className="backup-progress-heading">
            <span>{phaseLabels[progress.phase]}</span>
            <strong>{percentage === null ? "--%" : `${percentage}%`}</strong>
          </div>
          <progress
            className={percentage === null ? "indeterminate" : "determinate"}
            max={100}
            value={percentage === null ? undefined : percentage}
            aria-label={`${phaseLabels[progress.phase]}进度`}
          />
          <p>{progress.message}</p>
          <dl className="backup-progress-metrics">
            <div>
              <dt>数据量</dt>
              <dd>
                {progress.totalBytes === null
                  ? `已处理 ${formatBytes(progress.processedBytes)} / 总量待计算`
                  : `${formatBytes(progress.processedBytes)} / ${formatBytes(progress.totalBytes)}`}
              </dd>
            </div>
            <div>
              <dt>记录</dt>
              <dd>{formatRecordProgress(progress)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {selectedFile && inspection ? (
        <section className="backup-inspection-card" aria-label="已检查备份详情">
          <div className="backup-inspection-heading">
            <span><Icon name="check" size={18} /></span>
            <div>
              <small>{inspectionFormatLabel(inspection.format)}</small>
              <b>{selectedFile.name}</b>
              <em>{formatBytes(selectedFile.size)}</em>
            </div>
          </div>
          <dl className="backup-inspection-summary">
            <div><dt>WebDB</dt><dd>{inspection.databaseCount} 个</dd></div>
            <div><dt>WebDB 记录</dt><dd>{inspection.indexedDbRecordCount.toLocaleString("zh-CN")} 条</dd></div>
            <div><dt>SQLite 记录</dt><dd>{inspection.nativeSqliteRecordCount.toLocaleString("zh-CN")} 条</dd></div>
            <div><dt>应用偏好</dt><dd>{inspection.localStorageEntryCount.toLocaleString("zh-CN")} 项</dd></div>
          </dl>
          {inspection.sourceAccountKey ? (
            <div className="backup-source-account">
              <small>备份来源账号</small>
              <b>{inspection.sourceAccountLabel?.trim() || "未记录账号名称"}</b>
              <code>{inspection.sourceAccountKey}</code>
            </div>
          ) : null}
          {inspection.historyAccountKeys.length ? (
            <div className="backup-history-accounts">
              <small>发现 {inspection.historyAccountKeys.length} 个来源设备历史账号标识；与当前账号不同的标识将在恢复前逐项确认。</small>
              <ul>{inspection.historyAccountKeys.map((key: string) => <li key={key}><code>{key}</code></li>)}</ul>
            </div>
          ) : null}
          {inspection.nativeSqlitePresent && !inspection.nativeSqliteCanRestore ? (
            <p className="backup-native-warning" role="alert">
              当前环境不能恢复此文件中的 Android SQLite，已禁用恢复，避免只恢复部分数据。
            </p>
          ) : null}
          <button
            type="button"
            className="primary-button backup-restore-confirm-button"
            disabled={busy || !canRestore}
            onClick={() => void handleRestore()}
          >
            <Icon name="refresh" size={18} />
            {activeOperation === "restore" ? "正在恢复并校验写入…" : "确认范围并开始恢复"}
          </button>
        </section>
      ) : null}

      <section className="backup-privacy-notice">
        <span><Icon name="database" size={18} /></span>
        <div>
          <b>备份文件包含隐私资料</b>
          <p>文件可能包含居民、工单、签字和现场照片，请仅保存在可信设备并避免转发。Token、Cookie、Sign、密码和登录会话不会进入完整备份。</p>
          <small>恢复采用合并方式，不删除本机额外记录；任何失败及已回滚/未完全回滚状态会按服务返回原文展示。</small>
        </div>
      </section>

      <p className={`backup-restore-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
        {notice.text}
      </p>
    </div>
  );
}
