import type { WorkOrderDetail } from "../services/workOrderApi";
import { useEffect, useState, type ReactNode } from "react";
import type { DrawerKind, Theme, WorkOrder } from "../types/workOrder";
import { fetchDeviceIdentityPreview, isNativeRuntime, type DeviceIdentityPreview } from "../services/tauri";
import { Icon } from "./Icon";
import { PhotoTile } from "./PhotoTile";
import { StatusBadge } from "./WorkOrderList";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="detail-section"><h3>{title}</h3><dl>{children}</dl></section>;
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  return <div><dt>{label}</dt><dd>{text(value)}</dd></div>;
}

const browserPreview: DeviceIdentityPreview = {
  appId: "com.alibaba.android.rimet",
  appVersion: "8.3.35",
  platform: "Android 16 · zh-CN",
  requestAgent: "DDDigitalCis",
  userAgent: "AliApp(DingTalk/8.3.35) com.alibaba.android.rimet",
  referer: "DingTalk 小程序",
};

function DeviceIdentityPreviewSection() {
  const [preview, setPreview] = useState<DeviceIdentityPreview>(browserPreview);
  const [loading, setLoading] = useState(isNativeRuntime());

  useEffect(() => {
    if (!isNativeRuntime()) return;
    let cancelled = false;
    void fetchDeviceIdentityPreview()
      .then((value) => { if (!cancelled) setPreview(value); })
      .catch(() => { if (!cancelled) setPreview(browserPreview); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return <section className="settings-block device-preview"><div className="settings-heading"><span>设备标识信息预览</span><p>仅展示请求环境，不包含 Token、Cookie 或签名。</p></div>
    <dl className="device-identity-list">
      <div><dt>应用标识</dt><dd>{preview.appId}</dd></div>
      <div><dt>应用版本</dt><dd>{preview.appVersion}</dd></div>
      <div><dt>运行平台</dt><dd>{loading ? "正在读取…" : preview.platform}</dd></div>
      <div><dt>请求代理</dt><dd>{preview.requestAgent}</dd></div>
      <div className="wide"><dt>User-Agent</dt><dd>{preview.userAgent}</dd></div>
      <div className="wide"><dt>请求来源</dt><dd>{preview.referer}</dd></div>
    </dl>
  </section>;
}

export function AppDrawer({ type, order, detail, detailAjInfo, detailLoading, detailError, theme, libraryPhotos, defaultOperatorName, setDefaultOperatorName, setTheme, onClose, onLogout }: {
  type: DrawerKind;
  order: WorkOrder;
  detail: WorkOrderDetail | null;
  detailAjInfo: Record<string, unknown> | null;
  detailLoading: boolean;
  detailError: string | null;
  theme: Theme;
  libraryPhotos: string[];
  defaultOperatorName: string;
  setDefaultOperatorName: (value: string) => void;
  setTheme: (value: Theme) => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const titles = { detail: "工单详情", gallery: "本机图库", settings: "设置" };
  const header = asObject(detail?.tcisWoHeaderDto);
  const address = asObject(header.addressDetail);
  const userInfo = asObject(header.userinfo);
  const supplypoint = asObject(detailAjInfo?.tcisRsSupplypoint);
  const hasDetail = Boolean(detail);

  return <div className="drawer-overlay" onClick={onClose}><section className="drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-handle" /><header><h2>{titles[type]}</h2><button className="icon-button" onClick={onClose}><Icon name="close" /></button></header>
    {type === "detail" && <div className="drawer-content detail-content"><div className="detail-hero"><StatusBadge status={order.status} /><h3>{order.resident} · {order.unit}</h3><span>{detailLoading ? "正在加载 PC 工单详情…" : detailError ? "详情加载失败，以下为列表摘要" : "已加载 PC 完整详情"}</span></div><section className="detail-address"><span>服务地址</span><b>{text(header.addressDetailed ?? address.addressDetailed ?? order.address)}</b></section>{detailError ? <p className="detail-error">{detailError}</p> : null}<DetailSection title="工单信息"><DetailRow label="工单号" value={header.woNumber ?? order.woNumber} /><DetailRow label="工单名称" value={header.woName} /><DetailRow label="工单类型" value={[header.woMainTypeName, header.woDetailTypeName].filter(Boolean).join(" / ")} /><DetailRow label="状态" value={header.statusCode ?? order.backendStatusCode} /><DetailRow label="安检年度" value={header.securityCheckYear} /><DetailRow label="来源" value={[header.demandsSourceName, header.demandsChannelName].filter(Boolean).join(" / ")} /></DetailSection><DetailSection title="用户与联系人"><DetailRow label="用户姓名" value={header.userName ?? userInfo.userName ?? order.resident} /><DetailRow label="用户编号" value={header.userNumber ?? userInfo.userNumber} /><DetailRow label="联系人" value={header.contactPerson ?? userInfo.contactPerson} /><DetailRow label="联系电话" value={header.contactPhone ?? userInfo.contactPhone} /><DetailRow label="用户类型" value={header.userDetailType ?? userInfo.userDetailType} /></DetailSection><DetailSection title="地址与供气点"><DetailRow label="小区" value={address.compoundName} /><DetailRow label="楼栋" value={address.building ?? order.building} /><DetailRow label="单元/楼层/房号" value={[address.unitsNumber, address.floorNumber, address.roomNumber].filter(Boolean).join(" ")} /><DetailRow label="供气点" value={header.supplyPointId ?? supplypoint.supplypointId} /><DetailRow label="供气点描述" value={header.supplyPointDesc ?? supplypoint.addrDetailName ?? supplypoint.addrDetail} /></DetailSection><DetailSection title="时间与执行"><DetailRow label="计划日期" value={header.expectingDate} /><DetailRow label="派工时间" value={header.dispatchTime} /><DetailRow label="受理时间" value={header.accetpDate} /><DetailRow label="上次安检" value={supplypoint.lastAjTime ?? header.lastAjTime} /><DetailRow label="上次计划安检" value={supplypoint.lastPlanAjTime ?? header.lastPlanAjTime} /><DetailRow label="最近入户" value={header.lastHouseholdTime} /><DetailRow label="处理班组" value={header.receivingTeamName} /><DetailRow label="负责人" value={header.charegeOfPersonName} /></DetailSection><DetailSection title="处理信息"><DetailRow label="安检类别" value={header.securityCategory} /><DetailRow label="安检模式" value={header.securityMode} /><DetailRow label="关闭原因" value={header.closeReasonName ?? header.closeReason} /><DetailRow label="备注" value={header.remark} /><DetailRow label="客户反馈" value={header.customerFeedback} /></DetailSection>{!hasDetail && !detailLoading ? <p className="empty-hint">暂无详情数据</p> : null}</div>}
    {type === "gallery" && <div className="drawer-content"><p className="drawer-tip">共 {libraryPhotos.length} 张本机图片，仅用于为当前工单随机补图。</p><div className="gallery-grid">{libraryPhotos.map((photo, index) => <PhotoTile key={photo} label={photo} tone={["green", "blue", "purple", "gold"][index]} />)}<button className="add-photo"><Icon name="plus" /><span>导入图片</span></button></div></div>}
    {type === "settings" && <div className="drawer-content settings-content"><section className="settings-block appearance-settings"><div className="settings-heading"><span>外观设置</span><p>选择 KiDinDin 的界面显示方式。</p></div><div className="theme-select">{(["system", "light", "dark"] as Theme[]).map((item) => <button key={item} className={theme === item ? "active" : ""} onClick={() => setTheme(item)}><i className={`theme-swatch ${item}`} /><span>{item === "system" ? "跟随系统" : item === "light" ? "浅色" : "深色"}</span></button>)}</div></section><section className="settings-block operator-setting"><div className="settings-heading"><span>自定义默认流转人</span><p>批量提交与补发日志始终使用此名称，可在确认页继续修改。</p></div><input value={defaultOperatorName} onChange={(event) => setDefaultOperatorName(event.target.value)} placeholder="段鑫" /></section><DeviceIdentityPreviewSection /><section className="settings-block session"><span>当前会话</span><b>已登录 · 操作员</b><p>登录信息仅保存在此设备，退出后将立即清除。</p><button className="logout-button" onClick={onLogout}><Icon name="logout" size={17} />退出登录</button></section></div>}
  </section></div>;
}
