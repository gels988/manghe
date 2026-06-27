# MAYIJU 静态发布包

本项目可直接部署到 `GitHub Pages` 或 `Cloudflare Pages`，不依赖外部云数据库。

## 最小发布内容

保留以下文件与目录：

- `index.html/`
- `js/`
- `register.html`
- `juanzeng.html`
- `zixitong.html`
- `zijian.html`
- `_headers`
- `_redirects`
- `.nojekyll`

可选保留：

- `static-server.mjs`
- `signaling-server.mjs`
- `package.json`

## GitHub Pages

1. 新建仓库并上传整个目录。
2. 在仓库设置中启用 `GitHub Pages`。
3. 选择从主分支根目录发布。
4. 发布后访问：

```text
https://你的用户名.github.io/仓库名/register.html
```

## Cloudflare Pages

1. 连接 GitHub 仓库。
2. 构建命令留空。
3. 输出目录填写 `/` 或留空。
4. 发布后访问：

```text
https://你的项目.pages.dev/register.html
```

## 本地测试

```bash
npm install
npm run serve
npm run signal
```

页面地址：

```text
http://localhost:8000/register.html
```

WebSocket 信令：

```text
ws://localhost:8787
```

## 跨设备账本同步

1. 在 A 电脑进入 `zixitong.html`。
2. 点击 `导出账本 JSON`。
3. 将生成的 JSON 文件或文本传到 B 电脑。
4. 在 B 电脑进入 `zixitong.html`。
5. 点击 `选择账本文件` 或粘贴 JSON 后导入。

## 说明

- 推荐奖励、赠送激活码、成交日志全部保存在浏览器本地。
- 若更换浏览器或清理站点数据，需要先导出账本再迁移。
- 静态托管仅负责页面分发，不保存你的业务数据。
