# 到访不遇关单

## 结论

新版安检“到访不遇”是工单关闭分支，不进入正常安检表单。它使用独立附件组保存照片，进行前端附件数量校验，调用安检关单接口后，再写入一条操作日志。

## 流程

```text
打开入户/关单原因页
  -> 读取工单简要信息和 GD_GBYY 原因字典
  -> 选择到访不遇原因并上传照片
  -> 校验附件组及照片数量
  -> 401 工单先请求停止外接录音
  -> close4SecurityCheck 关闭工单
  -> exchange/log 写类型 80 日志
  -> 返回上级工单页面
```

## 原因与附件

页面从服务端字典 `GD_GBYY` 动态生成原因卡片，文本不是静态写死在包中的。每个原因使用独立字段：

`closeAttachBizId-{closeReason}`

提交前，将所选原因对应的附件组复制到最终字段 `closeAttachBizId`。

客户端将代码 `10`、`11`、`12`、`20` 作为带附件原因处理；其中 `10`、`11`、`12` 必须至少有两份附件。否则提示“请上传到访不遇单和张贴位置照片”。原因 `90` 要求备注和照片。

原因代码实际显示为什么文字由运行时的 `GD_GBYY` 字典决定；仅凭静态包不能将每个代码永久映射为具体中文名称。

## 关单请求顺序

对安检工单：

1. 若 `woDetailType === "401"`，请求 `orderStatusNotify(status=end)` 停止外接录音，并回写 `isRecording` 结束状态。
2. `POST api/workorder/tcisworkorder/close4SecurityCheck`，核心字段为：
   - `woHeaderId`
   - `closeReason`
   - `remark`
   - `closeAttachBizId`
3. `POST api/workorder/exchange/log`，写入：
   - `exchangeType: "80"`
   - 工单 ID、工单号
   - 字典解析后的关单原因和备注

该客户端路径只在提交后写日志；源码中未见关单后再查询日志确认落库的重试循环。

## 与正常入户的区别

正常入户使用 `closeReason: "ZC"` 分支，不直接关单。它要求门头照片，并附带定位、地址和附件组调用：

`POST api/workorder/tcisworkorderAj/updateLastHouseholdTime`

成功后才导航至正式安检页面。到访不遇不会进入这条入户安检分支。

## 踏勘单不是同一流程

包内另有踏勘单的到访不遇关闭页，调用：

`POST api/yhbz/tcisbzsurvey/closeTCisBzSurvey`

其参数为 `surveyId`、`closeReason`、`remark`，与安检工单的 `close4SecurityCheck` 和附件规则不同，不能混用。
