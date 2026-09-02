import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "../components/Icon";
import {
  exportCompleteBackup,
  inspectCompleteBackupFile,
  restoreCompleteBackupFile,
  type BackupArchiveInspection,
  type BackupArchiveProgress,
} from "../services/backupArchive";
import { backupHistoryStore } from "../services/backupHistoryStore";
import { formatBytes as formatByteSize } from "../services/backupCompression";
import "../styles/pages/backup-restore.css";

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

function formatTime(timestamp: number | null): string {
  if (!timestamp) return "从未备份";
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 30) return `${diffDays} 天前`;
  return date.toLocaleDateString("zh-CN");
}

export function BackupRestorePage({ accountKey, accountLabel, onBack }: BackupRestorePageProps) {
  const importInput = useRef<HTMLInputElement>(null);
  const operationLock = useRef(false);
  const operationSequence = useRef(0);
  const mounted = useRef(true);
  const operationStartTime = useRef<number>(0);
  const [activeOperation, setActiveOperation] = useState<ActiveOperation | null>(null);
  const [progress, setProgress] = useState<BackupArchiveProgress | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<BackupArchiveInspection | null>(null);
  const [notice, setNotice] = useState<Notice>({
    kind: "info",
    text: "可导出全部本地数据，或选择新流式备份及旧版 JSON 完整备份进行检查。",
  });
  const [stats, setStats] = useState(backupHistoryStore.getStats());
  const [showStats, setShowStats] = useState(false);

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const beginOperation = (operation: ActiveOperation) => {
    if (operationLock.current) return null;
    operationLock.current = true;
    operationSequence.current += 1;
    operationStartTime.current = Date.now();
    setActiveOperation(operation);
    setProgress(null);
    return operationSequence.current;
  };

  const endOperation = (sequence: number) => {
    if (sequence !== operationSequence.current) return;
    operationLock.current = false;
    if (mounted.current) {
      setActiveOperation(null);
      setProgress(null);
    }
  };

  const refreshStats = () => {
    setStats(backupHistoryStore.getStats());
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
      const duration = Date.now() - operationStartTime.current;

      showCompletedProgress(sequence, "完整备份导出完成", result.size, recordCount);

      // 记录备份历史
      backupHistoryStore.addEntry({
        type: "export",
        success: true,
        size: result.size,
        databaseCount: result.databaseCount,
        indexedDbRecordCount: result.indexedDbRecordCount,
        nativeSqliteRecordCount: result.nativeSqliteRecordCount,
        localStorageEntryCount: result.localStorageEntryCount,
        duration,
        fileName: result.fileName,
        method: result.method,
      });

      refreshStats();

      setNotice({
        kind: "success",
        text: result.method === "native"
          ? `完整备份已写入 ${result.destination}：${result.fileName}（${formatByteSize(result.size)}，${result.databaseCount} 个 WebDB、${result.indexedDbRecordCount.toLocaleString("zh-CN")} 条 WebDB 记录、${result.nativeSqliteRecordCount.toLocaleString("zh-CN")} 条 SQLite 记录、${result.localStorageEntryCount.toLocaleString("zh-CN")} 项偏好）`
          : `完整备份已发起浏览器下载：${result.fileName}（${formatByteSize(result.size)}，${result.databaseCount} 个 WebDB、${result.indexedDbRecordCount.toLocaleString("zh-CN")} 条 WebDB 记录、${result.nativeSqliteRecordCount.toLocaleString("zh-CN")} 条 SQLite 记录、${result.localStorageEntryCount.toLocaleString("zh-CN")} 项偏好）`,
      });
    } catch (error) {
      const reason = readErrorMessage(error);
      const duration = Date.now() - operationStartTime.current;

      // 记录失败的备份
      backupHistoryStore.addEntry({
        type: "export",
        success: false,
        size: 0,
        databaseCount: 0,
        indexedDbRecordCount: 0,
        nativeSqliteRecordCount: 0,
        localStorageEntryCount: 0,
        duration,
        error: reason || "未知错误",
      });

      refreshStats();

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
      const duration = Date.now() - operationStartTime.current;

      setSelectedFile(file);
      setInspection(nextInspection);
      showCompletedProgress(sequence, "备份检查完成，等待确认恢复", file.size, recordCount);

      // 记录检查历史
      backupHistoryStore.addEntry({
        type: "inspect",
        success: true,
        size: file.size,
        databaseCount: nextInspection.databaseCount,
        indexedDbRecordCount: nextInspection.indexedDbRecordCount,
        nativeSqliteRecordCount: nextInspection.nativeSqliteRecordCount,
        localStorageEntryCount: nextInspection.localStorageEntryCount,
        duration,
        fileName: file.name,
      });

      refreshStats();

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
      const duration = Date.now() - operationStartTime.current;

      // 记录失败的检查
      backupHistoryStore.addEntry({
        type: "inspect",
        success: false,
        size: file.size,
        databaseCount: 0,
        indexedDbRecordCount: 0,
        nativeSqliteRecordCount: 0,
        localStorageEntryCount: 0,
        duration,
        fileName: file.name,
        error: reason || "未知错误",
      });

      refreshStats();

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
      const duration = Date.now() - operationStartTime.current;

      const rolledBack = rollbackNotice(result);
      if (rolledBack) {
        // 记录失败的恢复
        backupHistoryStore.addEntry({
          type: "restore",
          success: false,
          size: selectedFile.size,
          databaseCount: inspection.databaseCount,
          indexedDbRecordCount: inspection.indexedDbRecordCount,
          nativeSqliteRecordCount: inspection.nativeSqliteRecordCount,
          localStorageEntryCount: inspection.localStorageEntryCount,
          duration,
          fileName: selectedFile.name,
          error: rolledBack,
        });
        refreshStats();
        setNotice({ kind: "error", text: rolledBack });
        return;
      }
      if (result.nativeSqliteRecordCount > 0 && !result.nativeSqlite) {
        backupHistoryStore.addEntry({
          type: "restore",
          success: false,
          size: selectedFile.size,
          databaseCount: inspection.databaseCount,
          indexedDbRecordCount: inspection.indexedDbRecordCount,
          nativeSqliteRecordCount: inspection.nativeSqliteRecordCount,
          localStorageEntryCount: inspection.localStorageEntryCount,
          duration,
          fileName: selectedFile.name,
          error: "SQLite 数据恢复结果缺失",
        });
        refreshStats();
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

      // 记录成功的恢复
      backupHistoryStore.addEntry({
        type: "restore",
        success: true,
        size: selectedFile.size,
        databaseCount: result.databaseCount,
        indexedDbRecordCount: result.indexedDbRecordCount,
        nativeSqliteRecordCount: result.nativeSqliteRecordCount,
        localStorageEntryCount: result.localStorageEntryCount,
        duration,
        fileName: selectedFile.name,
      });
      refreshStats();

      showCompletedProgress(sequence, "完整备份恢复完成", selectedFile.size, recordCount);
      setNotice({
        kind: "success",
        text: `完整备份恢复完成：${result.databaseCount} 个 WebDB 已合并检查 ${result.indexedDbRecordCount.toLocaleString("zh-CN")} 条，${sqliteText}，偏好 ${result.localStorageEntryCount.toLocaleString("zh-CN")} 项${mapping.preservedHistoryAccountCount ? `；${mapping.preservedHistoryAccountCount} 个其他账号标识按原值保留` : ""}。正在重新载入应用…`,
      });
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      const reason = readErrorMessage(error);
      const duration = Date.now() - operationStartTime.current;

      // 记录失败的恢复
      if (selectedFile && inspection) {
        backupHistoryStore.addEntry({
          type: "restore",
          success: false,
          size: selectedFile.size,
          databaseCount: inspection.databaseCount,
          indexedDbRecordCount: inspection.indexedDbRecordCount,
          nativeSqliteRecordCount: inspection.nativeSqliteRecordCount,
          localStorageEntryCount: inspection.localStorageEntryCount,
          duration,
          fileName: selectedFile.name,
          error: reason || "未知错误",
        });
        refreshStats();
      }

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

  const successRate = stats.totalBackups > 0
    ? ((stats.successfulBackups / stats.totalBackups) * 100).toFixed(1)
    : "0.0";

  return (
    <>
      <header className="topbar more-page-header">
        <button
          type="button"
          className="back-button"
          disabled={busy}
          onClick={() => {
            if (!operationLock.current) onBack();
          }}
          aria-label={busy ? "备份操作进行中，暂时不能返回" : "返回"}
          style={{ padding: "8px", marginRight: "8px", transform: "rotate(180deg)" }}
        >
          <Icon name="chevron" />
        </button>
        <div>
          <h1>备份与恢复</h1>
        </div>
        <span
          style={{
            marginLeft: "auto",
            padding: "4px 12px",
            borderRadius: "12px",
            fontSize: "12px",
            fontWeight: 600,
            background: busy ? "var(--color-warning-light)" : "var(--color-success-light)",
            color: busy ? "var(--color-warning)" : "var(--color-success)",
          }}
        >
          {busy ? "处理中" : "就绪"}
        </span>
      </header>

      {/* 当前账号卡片 */}
      <section className="more-page-summary" style={{ gridTemplateColumns: "1fr", margin: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "4px 0" }}>
          <Icon name="database" size={24} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>当前账号</span>
            <b style={{ display: "block", fontSize: "15px", marginTop: "2px" }}>{accountLabel || "未命名账号"}</b>
            <code style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>{accountKey ?? "缺少本地账号标识"}</code>
          </div>
        </div>
      </section>

      {/* 主要操作卡片 */}
      <section className="more-page-section">
        <div className="more-section-heading"><h2>备份操作</h2></div>
        <div className="more-tool-grid">
          <button type="button" className="more-feature-card" disabled={busy} onClick={() => void handleExport()}>
            <span className="more-feature-icon" style={{ background: "var(--color-primary-light)", color: "var(--color-primary)" }}>
              <Icon name="download" size={21} />
            </span>
            <span className="more-feature-copy">
              <b>{activeOperation === "export" ? "正在导出备份…" : "导出完整备份"}</b>
              <small>导出 WebDB、图片、签字、应用偏好及 SQLite</small>
            </span>
            <Icon name="chevron" size={18} />
          </button>

          <button type="button" className="more-feature-card" disabled={busy} onClick={() => importInput.current?.click()}>
            <span className="more-feature-icon" style={{ background: "var(--color-success-light)", color: "var(--color-success)" }}>
              <Icon name="upload" size={21} />
            </span>
            <span className="more-feature-copy">
              <b>{activeOperation === "inspect" ? "正在检查备份…" : "选择备份文件"}</b>
              <small>支持新流式备份和旧版 JSON 完整备份</small>
            </span>
            <Icon name="chevron" size={18} />
          </button>
          <input
            ref={importInput}
            hidden
            type="file"
            disabled={busy}
            aria-label="选择要检查和恢复的完整备份文件"
            onChange={(event) => void handleFileSelection(event)}
          />
        </div>
      </section>

      {/* 统计信息 */}
      {stats.totalBackups > 0 && (
        <section className="more-page-section">
          <div className="more-section-heading" style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingRight: "16px",
          }}>
            <h2>备份统计</h2>
            <button
              type="button"
              onClick={() => setShowStats(!showStats)}
              style={{
                padding: "6px 12px",
                background: "transparent",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                color: "var(--color-text-secondary)",
              }}
            >
              {showStats ? "收起" : "展开"}
              <Icon name={showStats ? "chevron-up" : "chevron-down"} size={14} />
            </button>
          </div>

          {/* 主要统计 - 始终显示 */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "10px",
            padding: "0 16px 16px",
          }}>
            <div style={{
              padding: "14px",
              background: "var(--color-surface)",
              borderRadius: "10px",
              textAlign: "center",
            }}>
              <div style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "var(--color-primary)",
                marginBottom: "4px",
              }}>
                {stats.totalBackups}
              </div>
              <div style={{
                fontSize: "11px",
                color: "var(--color-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}>
                总备份数
              </div>
            </div>

            <div style={{
              padding: "14px",
              background: "var(--color-surface)",
              borderRadius: "10px",
              textAlign: "center",
            }}>
              <div style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "var(--color-success)",
                marginBottom: "4px",
              }}>
                {successRate}%
              </div>
              <div style={{
                fontSize: "11px",
                color: "var(--color-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}>
                成功率
              </div>
            </div>

            <div style={{
              padding: "14px",
              background: "var(--color-surface)",
              borderRadius: "10px",
              textAlign: "center",
            }}>
              <div style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "var(--color-text)",
                marginBottom: "4px",
              }}>
                {formatBytes(stats.totalDataSize)}
              </div>
              <div style={{
                fontSize: "11px",
                color: "var(--color-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}>
                总数据量
              </div>
            </div>
          </div>

          {/* 详细统计 - 展开时显示 */}
          {showStats && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "10px",
              padding: "0 16px 16px",
            }}>
              <div style={{
                padding: "12px",
                background: "var(--color-background)",
                borderRadius: "8px",
              }}>
                <div style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  marginBottom: "6px",
                }}>
                  平均大小
                </div>
                <div style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}>
                  {formatBytes(stats.averageSize)}
                </div>
              </div>

              <div style={{
                padding: "12px",
                background: "var(--color-background)",
                borderRadius: "8px",
              }}>
                <div style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  marginBottom: "6px",
                }}>
                  最大备份
                </div>
                <div style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}>
                  {formatBytes(stats.largestBackup)}
                </div>
              </div>

              <div style={{
                padding: "12px",
                background: "var(--color-background)",
                borderRadius: "8px",
              }}>
                <div style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  marginBottom: "6px",
                }}>
                  总记录数
                </div>
                <div style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}>
                  {stats.totalRecords.toLocaleString("zh-CN")}
                </div>
              </div>

              <div style={{
                padding: "12px",
                background: "var(--color-background)",
                borderRadius: "8px",
              }}>
                <div style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  marginBottom: "6px",
                }}>
                  最后备份
                </div>
                <div style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}>
                  {formatTime(stats.lastSuccessfulBackupTime)}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 进度显示 */}
      {progress && (
        <section className="more-page-section">
          <div className="more-section-heading">
            <h2>{phaseLabels[progress.phase]}</h2>
          </div>
          <div style={{ padding: "0 16px 16px" }}>
            {/* 百分比和状态 */}
            <div style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: "12px",
            }}>
              <span style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "var(--color-text)",
              }}>
                {progress.message}
              </span>
              <strong style={{
                fontSize: "28px",
                fontWeight: 700,
                color: "var(--color-primary)",
                lineHeight: 1,
              }}>
                {percentage === null ? "--" : percentage}
                <span style={{ fontSize: "14px", marginLeft: "2px" }}>%</span>
              </strong>
            </div>

            {/* 进度条 */}
            <div style={{
              width: "100%",
              height: "12px",
              background: "var(--color-background)",
              borderRadius: "6px",
              overflow: "hidden",
              marginBottom: "16px",
            }}>
              <div style={{
                width: percentage === null ? "0%" : `${percentage}%`,
                height: "100%",
                background: "linear-gradient(90deg, var(--color-primary), var(--color-primary-dark))",
                transition: "width 0.3s ease",
              }} />
            </div>

            {/* 详细指标 */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px",
            }}>
              <div style={{
                padding: "12px",
                background: "var(--color-background)",
                borderRadius: "8px",
              }}>
                <div style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  marginBottom: "4px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}>
                  数据量
                </div>
                <div style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}>
                  {formatBytes(progress.processedBytes)}
                  <span style={{
                    fontSize: "12px",
                    fontWeight: 400,
                    color: "var(--color-text-secondary)",
                    marginLeft: "4px",
                  }}>
                    / {progress.totalBytes === null ? "计算中" : formatBytes(progress.totalBytes)}
                  </span>
                </div>
              </div>

              <div style={{
                padding: "12px",
                background: "var(--color-background)",
                borderRadius: "8px",
              }}>
                <div style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  marginBottom: "4px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}>
                  记录数
                </div>
                <div style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "var(--color-text)",
                }}>
                  {Math.max(0, Math.trunc(progress.processedRecords)).toLocaleString("zh-CN")}
                  <span style={{
                    fontSize: "12px",
                    fontWeight: 400,
                    color: "var(--color-text-secondary)",
                    marginLeft: "4px",
                  }}>
                    / {progress.totalRecords === null ? "计算中" : Math.max(0, Math.trunc(progress.totalRecords)).toLocaleString("zh-CN")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 检查结果卡片 */}
      {selectedFile && inspection && (
        <section className="more-page-section">
          <div className="more-section-heading"><h2>备份文件详情</h2></div>
          <div style={{ padding: "0 16px 16px" }}>
            {/* 文件信息卡片 */}
            <div style={{
              padding: "16px",
              background: "var(--color-success-light)",
              borderRadius: "12px",
              marginBottom: "16px",
              border: "1px solid var(--color-success)",
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "12px",
                color: "var(--color-success)",
              }}>
                <Icon name="check-circle" size={20} />
                <span style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}>
                  {inspectionFormatLabel(inspection.format)}
                </span>
              </div>
              <div style={{
                fontSize: "15px",
                fontWeight: 600,
                color: "var(--color-text)",
                marginBottom: "4px",
                wordBreak: "break-all",
              }}>
                {selectedFile.name}
              </div>
              <div style={{
                fontSize: "13px",
                color: "var(--color-text-secondary)",
              }}>
                {formatBytes(selectedFile.size)}
              </div>
            </div>

            {/* 数据统计 */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "10px",
              marginBottom: "16px",
            }}>
              <div style={{
                padding: "12px",
                background: "var(--color-background)",
                borderRadius: "8px",
              }}>
                <div style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  marginBottom: "6px",
                }}>
                  WebDB
                </div>
                <div style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "var(--color-text)",
                }}>
                  {inspection.databaseCount}
                  <span style={{ fontSize: "12px", fontWeight: 400, marginLeft: "4px" }}>个</span>
                </div>
              </div>

              <div style={{
                padding: "12px",
                background: "var(--color-background)",
                borderRadius: "8px",
              }}>
                <div style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  marginBottom: "6px",
                }}>
                  WebDB 记录
                </div>
                <div style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "var(--color-text)",
                }}>
                  {inspection.indexedDbRecordCount.toLocaleString("zh-CN")}
                  <span style={{ fontSize: "12px", fontWeight: 400, marginLeft: "4px" }}>条</span>
                </div>
              </div>

              <div style={{
                padding: "12px",
                background: "var(--color-background)",
                borderRadius: "8px",
              }}>
                <div style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  marginBottom: "6px",
                }}>
                  SQLite 记录
                </div>
                <div style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "var(--color-text)",
                }}>
                  {inspection.nativeSqliteRecordCount.toLocaleString("zh-CN")}
                  <span style={{ fontSize: "12px", fontWeight: 400, marginLeft: "4px" }}>条</span>
                </div>
              </div>

              <div style={{
                padding: "12px",
                background: "var(--color-background)",
                borderRadius: "8px",
              }}>
                <div style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  marginBottom: "6px",
                }}>
                  应用偏好
                </div>
                <div style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "var(--color-text)",
                }}>
                  {inspection.localStorageEntryCount.toLocaleString("zh-CN")}
                  <span style={{ fontSize: "12px", fontWeight: 400, marginLeft: "4px" }}>项</span>
                </div>
              </div>
            </div>

            {/* 来源账号信息 */}
            {inspection.sourceAccountKey && (
              <div style={{
                padding: "14px",
                background: "var(--color-background)",
                borderRadius: "8px",
                marginBottom: "16px",
              }}>
                <div style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  marginBottom: "8px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}>
                  备份来源账号
                </div>
                <div style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "var(--color-text)",
                  marginBottom: "6px",
                }}>
                  {inspection.sourceAccountLabel?.trim() || "未记录账号名称"}
                </div>
                <code style={{
                  fontSize: "11px",
                  color: "var(--color-text-tertiary)",
                  fontFamily: "var(--font-mono)",
                  background: "var(--color-surface)",
                  padding: "2px 6px",
                  borderRadius: "4px",
                }}>
                  {inspection.sourceAccountKey}
                </code>
              </div>
            )}

            {/* 警告或操作按钮 */}
            {inspection.nativeSqlitePresent && !inspection.nativeSqliteCanRestore ? (
              <div style={{
                padding: "14px",
                background: "var(--color-error-light)",
                borderLeft: "4px solid var(--color-error)",
                borderRadius: "8px",
                color: "var(--color-error)",
                fontSize: "13px",
                lineHeight: 1.5,
              }}>
                <strong style={{ display: "block", marginBottom: "4px" }}>无法恢复 SQLite 数据</strong>
                当前环境不能恢复此文件中的 Android SQLite，已禁用恢复功能。
              </div>
            ) : (
              <button
                type="button"
                className="primary-button"
                disabled={busy || !canRestore}
                onClick={() => void handleRestore()}
                style={{
                  width: "100%",
                  height: "48px",
                  fontSize: "15px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
              >
                <Icon name="refresh" size={20} />
                {activeOperation === "restore" ? "正在恢复并校验..." : "确认并开始恢复"}
              </button>
            )}
          </div>
        </section>
      )}

      {/* 隐私说明 */}
      <section style={{
        margin: "16px",
        padding: "12px",
        background: "var(--color-info-light)",
        borderLeft: "3px solid var(--color-info)",
        borderRadius: "8px",
        fontSize: "13px",
        lineHeight: 1.5,
        color: "var(--color-info)",
      }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <Icon name="database" size={18} />
          <div>
            <div style={{ fontWeight: 600, marginBottom: "4px" }}>备份文件包含隐私资料</div>
            <div style={{ color: "var(--color-text)" }}>
              文件可能包含居民、工单、签字和现场照片，请仅保存在可信设备并避免转发。Token、Cookie、Sign、密码和登录会话不会进入完整备份。
            </div>
          </div>
        </div>
      </section>

      {/* 状态通知 */}
      {notice.text && (
        <div
          style={{
            margin: "0 16px 16px",
            padding: "12px",
            borderRadius: "8px",
            fontSize: "13px",
            lineHeight: 1.5,
            background: notice.kind === "error"
              ? "var(--color-error-light)"
              : notice.kind === "success"
              ? "var(--color-success-light)"
              : notice.kind === "warning"
              ? "var(--color-warning-light)"
              : "var(--color-info-light)",
            color: notice.kind === "error"
              ? "var(--color-error)"
              : notice.kind === "success"
              ? "var(--color-success)"
              : notice.kind === "warning"
              ? "var(--color-warning)"
              : "var(--color-info)",
          }}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </div>
      )}
    </>
  );
}
