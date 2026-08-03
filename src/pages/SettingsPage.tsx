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
import {
  accentModeOptions,
  accentOptions,
  defaultAppearanceSettings,
  normalizeAppearanceSettings,
  themeModeOptions,
  themeOptions,
} from "../services/theme";
import { isNativeRuntime } from "../services/tauri";
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

function downloadJson(fileName: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function SettingsSwitch({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
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
  onOpenQuickConfig,
  setAppearanceSettings,
  setAppSettings,
  setDefaultOperatorName,
}: SettingsPageProps) {
  const settingsImportInput = useRef<HTMLInputElement>(null);
  const localImportInput = useRef<HTMLInputElement>(null);
  const [storage, setStorage] = useState<StorageSnapshot>({
    localStorageBytes: 0,
    quota: null,
    usage: null,
  });
  const [message, setMessage] = useState("");

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

  const handleSettingsImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
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
    }
  };

  const handleLocalImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await onImportLocalData(await file.text(), file.name);
      await refreshStorage();
    } catch {
      // App 统一展示账号范围或数据格式错误。
    } finally {
      input.value = "";
    }
  };

  const updateDisplay = (patch: Partial<AppSettings["display"]>) =>
    setAppSettings((current) => ({
      ...current,
      display: { ...current.display, ...patch },
    }));

  const updateVacantRoom = (patch: Partial<AppSettings["vacantRoom"]>) =>
    setAppSettings((current) => ({
      ...current,
      vacantRoom: { ...current.vacantRoom, ...patch },
    }));

  return (
    <>
      <header className="settings-page-header">
        <button type="button" className="back-button" onClick={onBack} aria-label="返回更多功能">
          <Icon name="chevron" size={21} />
        </button>
        <div>
          <span>设置中心</span>
          <h1>完整设置</h1>
        </div>
        <button type="button" className="settings-quick-button" onClick={onOpenQuickConfig}>
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
            <button type="button" className={appSettings.display.density === "comfortable" ? "active" : ""} onClick={() => updateDisplay({ density: "comfortable" })}>舒适</button>
            <button type="button" className={appSettings.display.density === "compact" ? "active" : ""} onClick={() => updateDisplay({ density: "compact" })}>紧凑</button>
          </div>
          <SettingsSwitch
            checked={appSettings.display.showToolDescriptions}
            label="显示工具说明"
            description="在更多功能宫格中显示每项工具的简短说明。"
            onChange={(checked) => updateDisplay({ showToolDescriptions: checked })}
          />
          <SettingsSwitch
            checked={appSettings.display.motion === "reduced"}
            label="减少界面动效"
            description="关闭非必要过渡动画；关闭时仍会遵循系统无障碍设置。"
            onChange={(checked) => updateDisplay({ motion: checked ? "reduced" : "system" })}
          />
        </div>
      </section>

      <section className="settings-page-section" id="behavior">
        <div className="settings-page-heading">
          <span className="settings-section-icon"><Icon name="tasks" size={18} /></span>
          <span><h2>空房工具</h2><p>控制打开页面时的默认勾选和逐单预存节奏。</p></span>
        </div>
        <div className="settings-page-group">
          <label className="settings-text-row">
            <span><b>默认流转人</b><small>批量提交和补发日志默认使用，可在确认页临时修改。</small></span>
            <input
              value={defaultOperatorName}
              onChange={(event) => setDefaultOperatorName(event.target.value)}
              placeholder="段鑫"
            />
          </label>
        </div>
        <div className="settings-page-group">
          <SettingsSwitch
            checked={appSettings.vacantRoom.autoSelectOrders}
            label="取单时自动选择工单"
            description="进入空房取单时，默认勾选当天识别到的空房。"
            onChange={(checked) => updateVacantRoom({ autoSelectOrders: checked })}
          />
          <SettingsSwitch
            checked={appSettings.vacantRoom.autoSelectImages}
            label="提取后自动选择图片"
            description="成功提取后默认选择去重后的全部图片，保存前仍可逐张取消。"
            onChange={(checked) => updateVacantRoom({ autoSelectImages: checked })}
          />
          <SettingsSwitch
            checked={appSettings.vacantRoom.fillAutoSelectOrders}
            label="填单时自动选择工单"
            description="进入空房填单时默认勾选待处理空房。"
            onChange={(checked) => updateVacantRoom({ fillAutoSelectOrders: checked })}
          />
          <label className="settings-select-row">
            <span><b>默认预存间隔</b><small>仅作用于逐单写入，页面内仍可临时调整。</small></span>
            <select
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
          <button type="button" disabled={localDataBusy} onClick={() => void onExportLocalData()}><Icon name="download" size={17} /><span><b>导出本地工单</b><small>仅当前账号收藏、置顶、备注和预约</small></span></button>
          <button type="button" disabled={localDataBusy} onClick={() => localImportInput.current?.click()}><Icon name="upload" size={17} /><span><b>导入本地工单</b><small>导入时仍按当前账号隔离</small></span></button>
          <button
            type="button"
            onClick={() => void clearVacantRoomImageCache().then(() => {
              setMessage("空房取单临时图片缓存已清除；系统相册中的已保存图片不受影响");
              void refreshStorage();
            }).catch((error) => setMessage(error instanceof Error ? error.message : "清除图片缓存失败"))}
          >
            <Icon name="trash" size={17} /><span><b>清除图片缓存</b><small>不会删除系统相册已保存文件</small></span>
          </button>
          <button type="button" className="danger" disabled={localDataBusy || localWorkOrderCount === 0} onClick={() => void onClearLocalData()}><Icon name="trash" size={17} /><span><b>清空本地工单</b><small>执行前会再次确认</small></span></button>
        </div>
        <input ref={localImportInput} hidden type="file" accept="application/json,.json" onChange={(event) => void handleLocalImport(event)} />
        {localDataMessage ? <p className="settings-page-message">{localDataMessage}</p> : null}
      </section>

      <section className="settings-page-section" id="advanced">
        <div className="settings-page-heading">
          <span className="settings-section-icon"><Icon name="database" size={18} /></span>
          <span><h2>备份、隐私与扩展</h2><p>设置结构带版本号，后续可安全增加更多配置分组。</p></span>
        </div>
        <div className="settings-page-group settings-data-actions">
          <button
            type="button"
            onClick={() => {
              downloadJson(`kidindin-settings-${new Date().toISOString().slice(0, 10)}.json`, {
                kind: "kidindin-settings",
                version: 1,
                exportedAt: new Date().toISOString(),
                appearance: appearanceSettings,
                defaultOperatorName,
                settings: appSettings,
              });
              setMessage("设置备份已导出；文件不包含 Token、Cookie、签名或密码");
            }}
          >
            <Icon name="download" size={17} /><span><b>导出设置备份</b><small>只包含外观和工具偏好</small></span>
          </button>
          <button type="button" onClick={() => settingsImportInput.current?.click()}><Icon name="upload" size={17} /><span><b>恢复设置备份</b><small>自动校验类型并补齐默认值</small></span></button>
          <button
            type="button"
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
          <button type="button" onClick={onOpenQuickConfig}><Icon name="settings" size={17} /><span><b>会话与账号维护</b><small>前往快速配置进行 Token 续期或退出登录</small></span></button>
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
