# 录音系统

## 结论

安检工单的录音不是由手机麦克风直接录制。客户端以员工电子工牌号和工单号调用 CEM 后端来启动、停止外接录音设备，并仅在工单中保存“是否已激活”、起止时间和操作结果。

该分支仅在 `woDetailType === "401"` 时启用。

## 流程

```text
进入安检
  -> orderStatusNotify(status=start)
  -> 更新工单 isRecording 行
  -> 执行安检、签字或关单
  -> orderStatusNotify(status=end)
  -> 更新 isRecording 的结束时间和结果
  -> 可按工单号查看并播放录音
```

### 启动

进入安检时调用：

`POST /api/appinterface/cem/custom/orderStatusNotify`

请求包含 `status: "start"`、`deviceNo`（当前员工工牌号）和 `orderNo`（工单号）。随后客户端读取完整工单并创建或覆盖 `attrCode: "isRecording"`：

- `attrVal`：`已激活` 或 `未激活`
- `attrDetail.startTime`
- `attrDetail.statResult`
- `attrDetail.endTime`：初始为空
- `attrDetail.endResult`：初始为空

设备离线或调用超时会将激活状态记为失败，并显示相应提示。

### 停止

关单、取消、签字提交等路径会调用同一接口，参数改为 `status: "end"`。客户端随后再次读取工单，将 `isRecording.attrDetail.endTime` 和 `endResult` 写回：

`POST /api/workorder/tcisworkorder/edit`

当前客户端即使收到“设备未在线”或“录音接口超时”，仍会继续后续的关单/提交流程；录音停止不是客户端的硬性阻断条件。

### 查询与回放

录音页通过下列接口取得该工单的录音列表：

`GET /api/appinterface/cem/custom/recordings?woNumber={工单号}`

每条记录使用 `callId` 内编码的起止时间显示录音区间，使用 `listenRecordUrl` 作为音频来源。播放前会先探测：

`GET /api/appinterface/audio/proxy?url={listenRecordUrl}`

成功后，将同一代理地址交给钉钉 `BackgroundAudioManager` 播放；支持进度、拖动和前后十秒。

若代理返回“录音文件正在上传”或找不到文件，客户端提示稍后重试。这说明录音文件由设备/服务端异步上传，工单关闭请求本身不携带音频二进制。

## 额外设备状态

客户端还会周期查询：

`GET /api/appinterface/cem/custom/getDevicePower?imei={工牌号}`

若返回低电量记录，会提示员工为电子工牌充电。

## 验证边界

静态包证明了客户端调用和字段顺序，不能单独证明设备已实际开始录音、服务端保存时长或录音文件的最终可用性。
