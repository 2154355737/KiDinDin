import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Icon } from "../components/Icon";
import {
  APP_SETTINGS_VERSION,
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
  type VacantRoomFillInterval,
} from "../services/appSettings";
import { clearVacantRoomImageCache } from "../services/vacantRoomApi";
import { saveUtf8JsonFile } from "../services/fullBackup";
import {
  accentModeOptions,
  accentOptions,
  defaultAppearanceSettings,
  normalizeAppearanceSettings,
  themeModeOptions,
  themeOptions,
} from "../services/theme";
import {
  fetchFloatingOverlayStatus,
  hideFloatingOverlay,
  isNativeRuntime,
  openWorkOrderRecognitionAccessibilitySettings,
  requestFloatingOverlayPermission,
  showFloatingOverlay,
  type FloatingOverlayStatus,
} from "../services/tauri";
import type { AppearanceSettings } from "../types/workOrder";

type SettingsPageProps = {
  accountLabel: string;
  appearanceSettings: AppearanceSettings;
  appSettings: AppSettings;
  defaultOperatorName: string;
  localDataBusy: boolean;
  localDataMessage: string;
  localWorkOrderCount: number;
  onBack: () => void;
  onClearLocalData: () => void | Promise<void>;
  onExportLocalData: () => void | Promise<void>;
  onImportLocalData: (json: string, fileName: string) => void | Promise<void>;
  onOpenBackupRestore: () => void;
  onOpenQuickConfig: () => void;
  setAppearanceSettings: Dispatch<SetStateAction<AppearanceSettings>>;
  setAppSettings: Dispatch<SetStateAction<AppSettings>>;
  setDefaultOperatorName: (value: string) => void;
};

type StorageSnapshot = {
  localStorageBytes: number;
  quota: number | null;
  usage: number | null;
};

const intervalOptions: Array<{ label: string; value: VacantRoomFillInterval }> = [
  { value: 0, label: "不间隔" },
  { value: 1, label: "1 秒" },
  { value: 2, label: "2 秒" },
  { value: 3, label: "3 秒" },
  { value: 5, label: "5 秒" },
  { value: 10, label: "10 秒" },
];

function bytesLabel(value: number | null) {
  if (value === null) return "设备未提供";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function localStorageBytes() {
  let size = 0;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    size += new Blob([key, localStorage.getItem(key) ?? ""]).size;
  }
  return size;
}

function SettingsSwitch({
  checked,
  description,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-page-row">
      <span>
        <b>{label}</b>
        <small>{description}</small>
      </span>
      <button
        type="button"
        className={`settings-switch ${checked ? "active" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </div>
  );
}

export function SettingsPage({
  accountLabel,
  appearanceSettings,
  appSettings,
  defaultOperatorName,
  localDataBusy,
  localDataMessage,
  localWorkOrderCount,
  onBack,
  onClearLocalData,
  onExportLocalData,
  onImportLocalData,
  onOpenBackupRestore,
  onOpenQuickConfig,
  setAppearanceSettings,
  setAppSettings,
  setDefaultOperatorName,
}: SettingsPageProps) {
  const settingsImportInput = useRef<HTMLInputElement>(null);
  const localImportInput = useRef<HTMLInputElement>(null);
  const backupOperationLock = useRef(false);
  const [storage, setStorage] = useState<StorageSnapshot>({
    localStorageBytes: 0,
    quota: null,
    usage: null,
  });
  const [message, setMessage] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [overlayStatus, setOverlayStatus] =
    useState<FloatingOverlayStatus | null>(null);

  const acquireBackupOperation = () => {
    if (backupOperationLock.current) return false;
    backupOperationLock.current = true;
    setBackupBusy(true);
    return true;
  };

  const releaseBackupOperation = () => {
    backupOperationLock.current = false;
    setBackupBusy(false);
  };

  const runExclusivePersistentOperation = async (
    operation: () => void | Promise<void>,
  ) => {
    if (!acquireBackupOperation()) return;
    try {
      await operation();
    } finally {
      releaseBackupOperation();
    }
  };

  const refreshStorage = async () => {
    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    setStorage({
      localStorageBytes: localStorageBytes(),
      quota: estimate?.quota ?? null,
      usage: estimate?.usage ?? null,
    });
  };

  useEffect(() => {
    void refreshStorage();
  }, [localWorkOrderCount, appSettings, appearanceSettings]);

  useEffect(() => {
    if (!isNativeRuntime()) return;
    const refreshOverlay = () => {
      void fetchFloatingOverlayStatus()
        .then(setOverlayStatus)
        .catch(() => setOverlayStatus(null));
    };
    refreshOverlay();
    window.addEventListener("focus", refreshOverlay);
    document.addEventListener("visibilitychange", refreshOverlay);
    return () => {
      window.removeEventListener("focus", refreshOverlay);
      document.removeEventListener("visibilitychange", refreshOverlay);
    };
  }, []);

  const handleSettingsImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!acquireBackupOperation()) {
      input.value = "";
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      if (parsed.kind !== "kidindin-settings" || parsed.version !== 1)
        throw new Error("不是受支持的 KiDinDin 设置备份");
      setAppearanceSettings(normalizeAppearanceSettings(parsed.appearance));
      setAppSettings(normalizeAppSettings(parsed.settings));
      if (typeof parsed.defaultOperatorName === "string")
        setDefaultOperatorName(parsed.defaultOperatorName.trim() || "段鑫");
      setMessage(`已从 ${file.name} 恢复设置；登录凭证未被读取`);
    } catch (error) {
      setMessage(error instanceof Error ? `导入失败：${error.message}` : "导入失败");
    } finally {
      input.value = "";
      releaseBackupOperation();
    }
  };

  const handleLocalImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!acquireBackupOperation()) {
      input.value = "";
      return;
    }
    try {
      await onImportLocalData(await file.text(), file.name);
      await refreshStorage();
    } catch {
      // App 统一展示账号范围或数据格式错误。
    } finally {
      input.value = "";
      releaseBackupOperation();
    }
  };

  const handleSettingsExport = async () => {
    if (localDataBusy || !acquireBackupOperation()) return;
    const fileName = `kidindin-settings-${new Date().toISOString().slice(0, 10)}.json`;
    const payload = JSON.stringify({
      kind: "kidindin-settings",
      version: 1,
      exportedAt: new Date().toISOString(),
      appearance: appearanceSettings,
      defaultOperatorName,
      settings: appSettings,
    }, null, 2);
    try {
      const saved = await saveUtf8JsonFile(fileName, payload);
      setMessage(
        saved.method === "native"
          ? `设置备份已写入 ${saved.destination}：${saved.fileName}；文件不包含登录凭据`
          : `设置备份已发起浏览器下载：${saved.fileName}；文件不包含登录凭据`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? `设置备份失败：${error.message}` : "设置备份失败");
    } finally {
      releaseBackupOperation();
    }
  };

  const updateDisplay = (patch: Partial<AppSettings["display"]>) => {
    if (backupOperationLock.current) return;
    setAppSettings((current) => ({
      ...current,
      display: { ...current.display, ...patch },
    }));
  };

  const updateVacantRoom = (patch: Partial<AppSettings["vacantRoom"]>) => {
    if (backupOperationLock.current) return;
    setAppSettings((current) => ({
      ...current,
      vacantRoom: { ...current.vacantRoom, ...patch },
    }));
  };

  const toggleFloatingOverlay = async () => {
    if (overlayBusy || !acquireBackupOperation()) return;
    setOverlayBusy(true);
    try {
      let current = overlayStatus ?? await fetchFloatingOverlayStatus();
      setOverlayStatus(current);
      if (!current.supported) {
        setMessage("跨应用悬浮窗仅支持 Android APK");
        return;
      }
      if (current.visible || current.enabled) {
        current = await hideFloatingOverlay();
        setOverlayStatus(current);
        setMessage("悬浮窗已关闭");
        return;
      }
      if (!current.permissionGranted) {
        await requestFloatingOverlayPermission();
        setMessage("请在系统页面允许 KiDinDin 显示在其他应用上层，返回后再开启悬浮窗");
        return;
      }
      await showFloatingOverlay();
      setOverlayStatus({ ...current, enabled: true, visible: true });
      window.setTimeout(() => {
        void fetchFloatingOverlayStatus()
          .then(setOverlayStatus)
          .catch(() => undefined);
      }, 250);
      setMessage("悬浮窗已开启；切到钉钉小程序后仍会显示");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "悬浮窗操作失败");
    } finally {
      setOverlayBusy(false);
      releaseBackupOperation();
    }
  };

  const openRecognitionAccessibility = async () => {
    if (overlayBusy || !acquireBackupOperation()) return;
    setOverlayBusy(true);
    try {
      await openWorkOrderRecognitionAccessibilitySettings();
      setMessage("请在系统辅助功能中启用“KiDinDin 工单识别”，返回后会自动刷新状态");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法打开辅助功能设置");
    } finally {
      setOverlayBusy(false);
      releaseBackupOperation();
    }
  };

  return (
    <>
      <header className="settings-page-header">
        <button type="button" className="back-button" disabled={backupBusy} onClick={onBack} aria-label="返回更多功能">
          <Icon name="chevron" size={21} />
        </button>
        <div>
          <span>设置中心</span>
          <h1>完整设置</h1>
        </div>
        <button type="button" className="settings-quick-button" disabled={backupBusy} onClick={onOpenQuickConfig}>
          快速配置
        </button>
      </header>

      <section className="settings-account-card">
        <span className="settings-account-icon"><Icon name="settings" size={22} /></span>
        <span><small>当前配置范围</small><b>{accountLabel}</b></span>
        <em>{isNativeRuntime() ? "Android 应用" : "桌面 / 浏览器"}</em>
      </section>

      <nav className="settings-page-index" aria-label="设置分类">
        {[
          ["appearance", "外观"],
          ["behavior", "操作"],
          ["storage", "存储"],
          ["advanced", "高级"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: appSettings.display.motion === "reduced" ? "auto" : "smooth" })}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="settings-page-section" id="appearance">
        <div className="settings-page-heading">
          <span className="settings-section-icon"><Icon name="settings" size={18} /></span>
          <span><h2>外观与显示</h2><p>主题、颜色、信息密度和动效偏好立即生效。</p></span>
        </div>

        <div className="settings-page-group">
          <h3>主题模式</h3>
          <div className="settings-choice-grid two-columns">
            {themeModeOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className={appearanceSettings.themeMode === option.id ? "active" : ""}
                disabled={backupBusy}
                onClick={() => setAppearanceSettings((current) => ({ ...current, themeMode: option.id }))}
              >
                <b>{option.label}</b><small>{option.description}</small>
              </button>
            ))}
          </div>
          {appearanceSettings.themeMode === "manual" ? (
            <div className="settings-preset-row">
              {themeOptions.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  className={appearanceSettings.manualTheme === option.id ? "active" : ""}
                  disabled={backupBusy}
                  onClick={() => setAppearanceSettings((current) => ({ ...current, manualTheme: option.id }))}
                >
                  <i className={`theme-swatch ${option.id}`} />{option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="settings-page-group">
          <h3>主色调</h3>
          <div className="settings-choice-grid two-columns">
            {accentModeOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className={appearanceSettings.accentMode === option.id ? "active" : ""}
                disabled={backupBusy}
                onClick={() => setAppearanceSettings((current) => ({ ...current, accentMode: option.id }))}
              >
                <b>{option.label}</b><small>{option.description}</small>
              </button>
            ))}
          </div>
          <div className="settings-accent-row">
            {accentOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                aria-label={option.label}
                className={appearanceSettings.accentMode === "manual" && appearanceSettings.manualAccent === option.id ? "active" : ""}
                disabled={backupBusy}
                onClick={() => setAppearanceSettings((current) => ({ ...current, accentMode: "manual", manualAccent: option.id }))}
              >
                <i className={`accent-swatch ${option.id}`} /><small>{option.label}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-page-group">
          <h3>界面密度</h3>
          <div className="settings-segmented">
            <button type="button" disabled={backupBusy} className={appSettings.display.density === "comfortable" ? "active" : ""} onClick={() => updateDisplay({ density: "comfortable" })}>舒适</button>
            <button type="button" disabled={backupBusy} className={appSettings.display.density === "compact" ? "active" : ""} onClick={() => updateDisplay({ density: "compact" })}>紧凑</button>
          </div>
          <SettingsSwitch
            checked={appSettings.display.showToolDescriptions}
            disabled={backupBusy}
            label="显示工具说明"
            description="在更多功能宫格中显示每项工具的简短说明。"
            onChange={(checked) => updateDisplay({ showToolDescriptions: checked })}
          />
          <SettingsSwitch
            checked={appSettings.display.motion === "reduced"}
            disabled={backupBusy}
            label="减少界面动效"
            description="关闭非必要过渡动画；关闭时仍会遵循系统无障碍设置。"
            onChange={(checked) => updateDisplay({ motion: checked ? "reduced" : "system" })}
          />
        </div>
      </section>

      <section className="settings-page-section" id="behavior">
        <div className="settings-page-heading">
          <span className="settings-section-icon"><Icon name="tasks" size={18} /></span>
          <span><h2>操作与悬浮工具</h2><p>控制跨应用入口、默认勾选和逐单预存节奏。</p></span>
        </div>
        <div className="settings-page-group settings-overlay-group">
          <h3>钉钉小程序辅助入口</h3>
          <SettingsSwitch
            checked={Boolean(overlayStatus?.visible || overlayStatus?.enabled)}
            disabled={backupBusy || overlayBusy}
            label="跨应用悬浮窗"
            description={
              overlayStatus?.permissionGranted
                ? "切到钉钉后保持显示；点击悬浮球可返回当前 KiDinDin 页面。"
                : "首次开启需要在 Android 系统页面授予显示在其他应用上层权限。"
            }
            onChange={() => void toggleFloatingOverlay()}
          />
          <div className="settings-overlay-status" aria-live="polite">
            <span className={overlayStatus?.permissionGranted ? "ready" : "pending"}>
              {overlayStatus?.permissionGranted ? "已授权" : "待授权"}
            </span>
            <span className={overlayStatus?.visible ? "ready" : "idle"}>
              {overlayBusy ? "处理中" : overlayStatus?.visible ? "显示中" : "未显示"}
            </span>
            <span className={overlayStatus?.accessibilityEnabled ? "ready" : "pending"}>
              {overlayStatus?.accessibilityEnabled ? "工单识别已开启" : "工单识别待开启"}
            </span>
            <small>
              {overlayStatus?.recognition?.message || "仅在点击悬浮窗“识别当前工单”后执行一次本地 OCR；截图不保存、不上传，匹配不唯一时不会执行预填。"}
            </small>
          </div>
          <button
            type="button"
            className="settings-overlay-accessibility"
            disabled={backupBusy || overlayBusy || overlayStatus?.accessibilityEnabled}
            onClick={() => void openRecognitionAccessibility()}
          >
            <Icon name="scan" size={15} />
            {overlayStatus?.accessibilityEnabled ? "工单识别辅助功能已启用" : "开启工单识别辅助功能"}
          </button>
        </div>
        <div className="settings-page-group">
          <h3>调试与诊断</h3>
          <SettingsSwitch
            checked={appSettings.diagnostics.showWatermarkGenerationDebug}
            disabled={backupBusy}
            label="显示水印生成调试输出"
            description="在到访不遇确认页显示本地处理、上传、附件查询和预览下载的分阶段耗时"
            onChange={(checked) => setAppSettings((current) => ({
              ...current,
              diagnostics: {
                ...current.diagnostics,
                showWatermarkGenerationDebug: checked,
              },
            }))}
          />
        </div>
        <div className="settings-page-group">
          <label className="settings-text-row">
            <span><b>默认流转人</b><small>批量提交和补发日志默认使用，可在确认页临时修改。</small></span>
            <input
              disabled={backupBusy}
              value={defaultOperatorName}
              onChange={(event) => setDefaultOperatorName(event.target.value)}
              placeholder="段鑫"
            />
          </label>
        </div>
        <div className="settings-page-group">
          <SettingsSwitch
            checked={appSettings.vacantRoom.autoSelectOrders}
            disabled={backupBusy}
            label="取单时自动选择工单"
            description="进入空房取单时，默认勾选当天识别到的空房。"
            onChange={(checked) => updateVacantRoom({ autoSelectOrders: checked })}
          />
          <SettingsSwitch
            checked={appSettings.vacantRoom.autoSelectImages}
            disabled={backupBusy}
            label="提取后自动选择图片"
            description="成功提取后默认只选择门牌、厨房、户内管、燃气表各一张，保存前仍可调整。"
            onChange={(checked) => updateVacantRoom({ autoSelectImages: checked })}
          />
          <SettingsSwitch
            checked={appSettings.vacantRoom.fillAutoSelectOrders}
            disabled={backupBusy}
            label="填单时自动选择工单"
            description="进入空房填单时默认勾选待处理空房。"
            onChange={(checked) => updateVacantRoom({ fillAutoSelectOrders: checked })}
          />
          <label className="settings-select-row">
            <span><b>默认预存间隔</b><small>仅作用于逐单写入，页面内仍可临时调整。</small></span>
            <select
              disabled={backupBusy}
              value={appSettings.vacantRoom.fillIntervalSeconds}
              onChange={(event) => updateVacantRoom({ fillIntervalSeconds: Number(event.target.value) as VacantRoomFillInterval })}
            >
              {intervalOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <p className="settings-safety-rule"><Icon name="check" size={14} />无可填内容的工单始终自动取消勾选，不能被批量写入。</p>
        </div>
      </section>

      <section className="settings-page-section" id="storage">
        <div className="settings-page-heading">
          <span className="settings-section-icon"><Icon name="database" size={18} /></span>
          <span><h2>存储与本地数据</h2><p>查看设备占用并维护当前账号的离线资料。</p></span>
          <button type="button" className="settings-refresh-storage" onClick={() => void refreshStorage()} aria-label="刷新存储统计"><Icon name="refresh" size={15} /></button>
        </div>
        <div className="settings-storage-grid">
          <div><small>Web 数据估算</small><b>{bytesLabel(storage.usage)}</b></div>
          <div><small>设备配额</small><b>{bytesLabel(storage.quota)}</b></div>
          <div><small>偏好数据</small><b>{bytesLabel(storage.localStorageBytes)}</b></div>
          <div><small>本地工单</small><b>{localWorkOrderCount} 条</b></div>
        </div>
        <div className="settings-page-group settings-data-actions">
          <button type="button" disabled={backupBusy || localDataBusy} onClick={() => void runExclusivePersistentOperation(onExportLocalData)}><Icon name="download" size={17} /><span><b>导出本地工单</b><small>仅当前账号收藏、置顶、备注和预约</small></span></button>
          <button type="button" disabled={backupBusy || localDataBusy} onClick={() => localImportInput.current?.click()}><Icon name="upload" size={17} /><span><b>导入本地工单</b><small>导入时仍按当前账号隔离</small></span></button>
          <button
            type="button"
            disabled={backupBusy}
            onClick={() => void runExclusivePersistentOperation(async () => {
              await clearVacantRoomImageCache();
              setMessage("空房取单临时图片缓存已清除；系统相册中的已保存图片不受影响");
              await refreshStorage();
            }).catch((error) => setMessage(error instanceof Error ? error.message : "清除图片缓存失败"))}
          >
            <Icon name="trash" size={17} /><span><b>清除图片缓存</b><small>不会删除系统相册已保存文件</small></span>
          </button>
          <button type="button" className="danger" disabled={backupBusy || localDataBusy || localWorkOrderCount === 0} onClick={() => void runExclusivePersistentOperation(onClearLocalData)}><Icon name="trash" size={17} /><span><b>清空本地工单</b><small>执行前会再次确认</small></span></button>
        </div>
        <input ref={localImportInput} hidden type="file" accept="application/json,.json" onChange={(event) => void handleLocalImport(event)} />
        {localDataMessage ? <p className="settings-page-message">{localDataMessage}</p> : null}
      </section>

      <section className="settings-page-section" id="advanced">
        <div className="settings-page-heading">
          <span className="settings-section-icon"><Icon name="database" size={18} /></span>
          <span><h2>备份、隐私与扩展</h2><p>设置结构带版本号，后续可安全增加更多配置分组。</p></span>
        </div>
        <div className="settings-page-group settings-data-actions settings-full-backup-actions">
          <button type="button" disabled={backupBusy || localDataBusy} onClick={onOpenBackupRestore}>
            <Icon name="database" size={17} /><span><b>打开备份与恢复</b><small>独立进度页，流式处理数 GB WebDB 图片、签字和 Android SQLite</small></span>
          </button>
          <p className="settings-safety-rule"><Icon name="check" size={14} />大型完整备份不再受旧版 96MB JSON 上限限制；登录凭据和临时缓存始终排除。</p>
        </div>
        <div className="settings-page-group settings-data-actions">
          <button
            type="button"
            disabled={backupBusy || localDataBusy}
            onClick={() => void handleSettingsExport()}
          >
            <Icon name="download" size={17} /><span><b>导出设置备份</b><small>只包含外观和工具偏好</small></span>
          </button>
          <button type="button" disabled={backupBusy} onClick={() => settingsImportInput.current?.click()}><Icon name="upload" size={17} /><span><b>恢复设置备份</b><small>自动校验类型并补齐默认值</small></span></button>
          <button
            type="button"
            disabled={backupBusy}
            onClick={() => {
              if (!window.confirm("确定恢复全部外观和工具设置为默认值吗？本地工单和登录状态不会被删除。")) return;
              setAppearanceSettings(defaultAppearanceSettings);
              setAppSettings(defaultAppSettings);
              setDefaultOperatorName("段鑫");
              setMessage("外观和工具设置已恢复默认值");
            }}
          >
            <Icon name="refresh" size={17} /><span><b>恢复默认设置</b><small>不影响工单资料和登录会话</small></span>
          </button>
          <button type="button" disabled={backupBusy} onClick={onOpenQuickConfig}><Icon name="settings" size={17} /><span><b>会话与账号维护</b><small>前往快速配置进行 Token 续期或退出登录</small></span></button>
        </div>
        <input ref={settingsImportInput} hidden type="file" accept="application/json,.json" onChange={(event) => void handleSettingsImport(event)} />
        <dl className="settings-system-info">
          <div><dt>设置架构</dt><dd>v{APP_SETTINGS_VERSION}</dd></div>
          <div><dt>运行环境</dt><dd>{isNativeRuntime() ? "Tauri Android" : "Web / Desktop"}</dd></div>
          <div className="wide"><dt>安全边界</dt><dd>凭证由原生会话维护，不进入设置备份或本地工单导出；存储区域只展示汇总数字。</dd></div>
        </dl>
      </section>

      {message ? <p className="settings-page-global-message" role="status" aria-live="polite">{message}</p> : null}
    </>
  );
}
