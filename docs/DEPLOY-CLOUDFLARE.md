# 部署到 Cloudflare Workers

Firefly 是**全站预渲染的纯静态站点**：`astro build` 直接把站点输出到 `dist/`，
Cloudflare Workers 只负责托管这些静态文件。因此**不需要** `@astrojs/cloudflare` adapter，
也不需要配置 Worker 入口（`main`）。

## 为什么不用 adapter

启用 `@astrojs/cloudflare` 会把产物拆成 `dist/client`（静态资源）+ `dist/server`（SSR 入口）。
由于本站全部页面都在构建期预渲染，`dist/server` 是空的，却让 `assets.directory`
指向了不含 `index.html` 的目录，部署后会出现整站 404。
纯静态站的官方推荐做法就是不引入 adapter（见
[Cloudflare Astro 指南](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)）。

## 方式一：连接 Git 仓库自动部署（推荐）

1. Cloudflare 控制台 → **Workers & Pages** → **Create** → **Connect to Git**
2. 选择你 fork 后的仓库
3. 构建配置填写：

   | 配置项 | 值 |
   | --- | --- |
   | 构建命令 | `pnpm build` |
   | 部署命令 | `npx wrangler deploy` |
   | 根目录 | `/` |
   | Node 版本 | `22`（见 `.nvmrc`） |

4. 保存并部署。之后每次 push 到对应分支都会自动重建。

## 方式二：本地命令行部署

```bash
pnpm install
pnpm deploy     # 等价于 pnpm build && wrangler deploy
```

首次执行 `wrangler deploy` 会要求登录 Cloudflare 账号。

## 自定义 Worker 名称

`wrangler.jsonc` 中的 `name` 决定 Worker 名称与默认访问域名
（`<name>.<你的子域>.workers.dev`）。如果已被占用，改成你自己的名字即可：

```jsonc
{
  "name": "my-firefly-blog"
}
```

## 关键配置说明

| 配置 | 作用 |
| --- | --- |
| `assets.directory: "./dist"` | 静态资源目录，必须与 Astro 输出一致 |
| `assets.not_found_handling: "404-page"` | 未匹配路径返回自带的 `404.html` |
| `compatibility_flags: ["nodejs_compat"]` | 构建/运行时的 Node API 兼容 |
| `public/_headers` | 安全响应头 + 静态资源强缓存 |

## 常见问题

**部署后整站 404**
检查 `assets.directory` 是否指向真正含 `index.html` 的目录。若你启用了 adapter，
产物会在 `dist/client`，此时应写成 `"./dist/client"`。

**搜索没有结果**
Pagefind 索引由 `pnpm build` 末尾的 `scripts/run-pagefind.ts` 生成到 `dist/pagefind/`。
若直接跑 `astro build` 而没跑完整 `pnpm build`，索引不会生成。

**构建时字体下载失败**
Astro Fonts API 会在构建期从 CDN 拉取字体。网络不稳定时重试即可，已下载的字体会缓存在
`node_modules/.astro/fonts/`，重跑会跳过已缓存部分。
