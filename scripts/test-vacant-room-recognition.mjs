import assert from "node:assert/strict";
import test from "node:test";
import {
  isVacantRoom,
  isVacantRoomTarget,
} from "../src/services/vacantRoomTarget.ts";

test("recognizes work orders named 需持安检单开户 as vacant rooms", () => {
  assert.equal(
    isVacantRoom({
      backendStatusCode: "20",
      resident: "普通住户",
      raw: { woName: "需持安检单开户" },
    }),
    true,
  );
});

test("recognizes the resident label format shown in the work-order list", () => {
  assert.equal(
    isVacantRoom({
      backendStatusCode: "20",
      resident: "（需持安检单开户）1单元15楼2号",
      raw: {},
    }),
    true,
  );
});

test("keeps the existing 需首检 resident marker", () => {
  assert.equal(
    isVacantRoom({
      backendStatusCode: "20",
      resident: "普通住户需首检",
      raw: {},
    }),
    true,
  );
});

test("only pending vacant rooms are fill targets", () => {
  assert.equal(
    isVacantRoomTarget({
      backendStatusCode: "30",
      resident: "普通住户",
      raw: { woName: "需持安检单开户" },
    }),
    false,
  );
});
