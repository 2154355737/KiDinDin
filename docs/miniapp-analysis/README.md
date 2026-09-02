# 钉钉小程序逻辑分析（新版本）

- 来源包：`2021001142645745`，版本目录 `2c42a83c1912b30e5a72cca593e67524`
- 分析范围：新版本客户端静态包中的 `index.worker.js`。
- 边界：本文记录客户端可见的流程、校验和请求顺序；不包含账号、Cookie、令牌或业务数据，也不推断服务端未公开的校验。

文档：

- [录音系统](01-recording-system.md)
- [到访不遇关单](02-unreachable-visit.md)
- [到访不遇图片水印](03-unreachable-visit-image-watermark.md)
