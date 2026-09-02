const STORAGE_PREFIX = "kidindin.employee-badge.v1:";

function keyFor(accountKey: string) {
  return `${STORAGE_PREFIX}${accountKey}`;
}

export function getEmployeeBadgeCode(accountKey: string | null) {
  if (!accountKey) return "";
  try {
    return (localStorage.getItem(keyFor(accountKey)) ?? "").trim();
  } catch {
    return "";
  }
}

export function saveEmployeeBadgeCode(accountKey: string, badgeCode: string) {
  const normalized = badgeCode.trim();
  if (!normalized) throw new Error("工牌二维码内容不能为空");
  try {
    localStorage.setItem(keyFor(accountKey), normalized);
  } catch {
    throw new Error("当前环境无法保存工牌绑定");
  }
  return normalized;
}
