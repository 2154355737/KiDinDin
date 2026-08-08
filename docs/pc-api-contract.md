# PC 项目 API 契约梳理

来源是 `E:\NodeJs\顶顶` 的 `src/services/workOrderApi.ts`、`src/services/authApi.ts`、`src/types/workOrder.ts` 和已脱敏抓包记录。所有业务接口都使用 JSON 外壳：`{ code: number, msg: string | null, data: T }`；`code === 0` 才能继续后续动作。

## 会话和传输

- PC 开发环境由 Vite 本地代理代发请求，以补齐 `Authorization: Bearer <token>`、`Cookie`、`sign`、`x-request-id`、钉钉移动端 User-Agent、`agent: DDDigitalCis` 与 Referer 等请求头。
- Android 不能依赖浏览器端设置这些受限请求头，也不应直接请求跨域 API。因此本项目改为 Tauri Rust 原生层代发；会话只在内存中保存，退出即清除。
- 登录响应可为 Bearer token，或含 `access_token` / `accessToken` / `token` / `authorization`（也支持这些字段位于 `data`）的 JSON。Cookie 和 sign 可以从 JSON 读取，也可在登录页单独输入。

## 读取接口

| 接口 | 方法与请求 | `data` 响应结构 |
| --- | --- | --- |
| `/api/workorder/tcisworkorderAj/queryAjWorkOrderList` | POST `{ createTime: "YYYY-MM-DD 00:00:00" }`；仅当旧服务明确返回参数校验错误时回退 `{ expectingDate: "YYYY-MM-DD 00:00:00" }` | `WorkOrderItem[]`；关键字段：`woHeaderId`、`woNumber`、`statusCode`、`userinfoId`、`supplypointId`、`userName`、`addressDetailed`、`addressDetail` |
| `/api/workorder/tcisworkorder/woInfoWithAttrAndParties/{id}` | GET | `WorkOrderDetailData`：`tcisWoHeaderDto`、属性/人员/行项目/物料数组 |
| `/api/workorder/tcisworkorder/queryWoInfoForNail/{id}` | POST | 同 `WorkOrderDetailData`，用于安检表单 |
| `/api/workorder/tcisworkorder/{id}` | POST | 同 `WorkOrderDetailData`，编辑页完整详情 |
| `/api/workorder/tcisworkorder/simple/{id}` | GET | 简略 `WorkOrderDetailData` |
| `/api/yhbz/bzUserInfo/detailForAj/?userInfoId=&supplypointId=` | POST | 用户安检信息，包含 `addressInfo`、`tcisRsSupplypoint`、用户标签 |
| `/api/appsys/file/list?bizId=` | GET | 附件数组，或 `{ sysAttachList | records | list }`；附件字段为 `attachId`、`bizId`、`fileName`、`downloadFilePath` |
| `/api/workorder/tcisworkorder/newCriteria` | POST `{ queryInfo:{ dateCreateStart:"", dateCreateEnd:"", userinfoId }, page:{ pageSize,pageIndex,orders } }` | 历史工单数组，或 `{ records | list | rows }`；安卓端已做分页聚合 |
| `/api/workorder/exchange/log/query_by_wo` | POST `{ woHeaderId, page:{ pageSize,pageIndex } }` | 流转日志数组，或 `{ records | list | rows }`；单项含 `exchangeType`、`content`、`createTime`、`userName` |

## 写入接口

| 接口 | 方法与请求 | `data` 响应结构 |
| --- | --- | --- |
| `/api/appsys/file/upload` | multipart：`watermarkStyle.rotate`、`bizId`、`isIphone=false`、`addWatermark=false`、`watermarkStyle.color`、多个 `multipartFiles` | `{ bizId, sysAttachList?: UploadedFile[] }`；`bizId` 是关闭工单所需附件业务号 |
| `/api/workorder/tcisworkorder/edit` | POST 完整 `WorkOrderDetailData` | `WorkOrderDetailData` |
| `/api/workorder/tcisworkorderAj/editAct` | POST `{ tcisWoHeaderDto, tcisWoLineDtoList }` | `WorkOrderDetailData` |
| `/api/workorder/tcisworkorderAj/updateLastHouseholdTime` | POST `{ woHeaderId, woYear, reachSceneGeocode:{ longitude,latitude }, closeAttachBizId,address }` | `null` |
| `/api/appinterface/cem/custom/orderStatusNotify` | POST `{ status, deviceNo, orderNo }` | 未固定结构，统一以业务 `code` 判断 |
| `/api/workorder/tcisworkorder/close4SecurityCheck` | POST `{ remark, closeAttachBizId, "closeAttachBizId-ZC":"", closeReason:"11", "closeAttachBizId-11":closeAttachBizId, woHeaderId }` | 字符串或 `null`；`closeReason: "11"` 代表到访不遇 |
| `/api/workorder/exchange/log` | POST `{ exchangeType:"80", woHeaderId, woNumber, userName, params:{ closeReason,remark } }` | 未固定结构，统一以业务 `code` 判断 |

## 安卓端执行语义

批量操作对每单固定串行执行：选择历史照片和本机补图 → 原生 multipart 上传 → 用上传返回的 `data.bizId` 调用 `close4SecurityCheck` → 创建 `exchange/log`。关闭成功但写日志失败会标成“日志失败”，补发只调用日志接口，绝不重复关闭工单。
