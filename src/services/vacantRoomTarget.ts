import type { WorkOrder } from "../types/workOrder";

const VACANT_ROOM_ORDER_NAME = "需持安检单开户";

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function isVacantRoom(order: WorkOrder) {
  return (
    order.resident.includes("需首检") ||
    order.resident.includes(VACANT_ROOM_ORDER_NAME) ||
    text(order.raw?.woName).includes(VACANT_ROOM_ORDER_NAME)
  );
}

export function isVacantRoomTarget(order: WorkOrder) {
  return order.backendStatusCode === "20" && isVacantRoom(order);
}
