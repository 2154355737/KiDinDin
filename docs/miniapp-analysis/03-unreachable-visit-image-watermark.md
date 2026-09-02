# 到访不遇图片水印

## 结论

新版“到访不遇”关单照片走通用 `UploadFile` 上传组件，但关单原因页面没有为它开启 `isSecurityUpload`。因此上传请求会传递：

```text
addWatermark=false
watermarkStyle.rotate=""
watermarkStyle.color=""
address=""
```

从客户端代码可确认：到访不遇照片不会由客户端要求服务端加水印；客户端也没有把文字绘制到照片 Canvas 后再上传。

## 上传实现

图片可来自相册或相机。通用组件会按图片尺寸尝试压缩，然后调用：

`POST /api/appsys/file/upload`

上传字段为 `multipartFiles`，文件类型为 `image`。表单字段包括：

- `bizId`：当前原因对应的附件组 ID；
- `isIphone`：由运行平台决定；
- `address`：只有调用方开启 `isSendAddress` 时才发送；
- `addWatermark`：由 `isSecurityUpload` 控制；
- `watermarkStyle.rotate`、`watermarkStyle.color`：仅在开启安全上传时发送样式。

安全上传开启时，客户端请求值为：

```text
addWatermark=true
watermarkStyle.rotate=0
watermarkStyle.color=EE2C2C
```

这说明水印渲染责任在上传服务端；客户端只传开关和样式参数。源码没有出现用于照片水印的 `canvas`、绘字或叠加图片操作。包内的 Canvas 仅用于签名图片生成。

## 为什么到访不遇没有开启

到访不遇页面只是按原因生成 `type: "attach"` 的附件卡，并传递 `closeAttachBizId-{原因代码}`。这一路没有设置 `isSecurityUpload` 或 `isSendAddress`。

相反，包中只有部分动态工单类型会主动对附件项设置 `isSecurityUpload=true`，例如代码中明确处理的部分 `workorderType` 为 `20`、`30` 的动态附件。这不是到访不遇关单页。

## 地址来源与定位边界

通用组件只有在调用方传入 `isSendAddress=true` 时才把 `address` 放进上传表单。地址值本身来自钉钉 `getLocation()` 的 `address` 返回字段；同一小程序也会把该地址及经纬度用于“到达现场”等工单定位接口。

但本版本静态包中没有发现到访不遇页面给上传组件传入 `isSendAddress=true`，也没有发现把水印文本、坐标或地址在客户端绘制进图片的代码。因此无法从客户端得出“开启水印时必定显示哪一个地址”这一结论；若服务端需要地址，只能使用上传表单中实际收到的 `address`，或按工单/设备上下文自行补充。

## 需要区分的事实

- **已确认**：到访不遇客户端请求 `addWatermark=false`，且不提交地址水印字段。
- **未能从静态包确认**：服务端会不会无视该开关仍对文件二次处理；水印最终包含什么文字、时间、坐标或人员信息。
- **验证方法**：在授权测试工单上上传一张无敏感内容的测试照片，比较上传前后的文件像素和接口返回附件；不要用真实住户照片或保存会话数据。
