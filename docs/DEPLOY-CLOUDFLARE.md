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

---

# 后台与 D1 架构（当前版本）

本版本引入后台管理，内容存 Cloudflare D1，公开站通过 Astro Live Collections 实时读取。

## 与纯静态版的区别

| 项目 | 纯静态版 | 当前版本 |
| --- | --- | --- |
| 渲染 | 全站构建期预渲染 | 全站运行时光渲染（`output: "server"`） |
| 内容来源 | `src/content/**` 文件 | D1 数据库 |
| 发布生效 | 需重新部署 | 后台保存即生效 |
| 搜索 | Pagefind 静态索引 | D1 关键词检索（`/api/search.json`） |
| wrangler | `assets: ./dist`，无 main | `main: 适配器入口`，`assets: ./dist/client` |

## 首次部署步骤

```bash
pnpm install
pnpm build                      # 末尾会生成 migrations/0002_seed_content.sql
npx wrangler d1 create firefly-cms   # 若用自动供应可跳过
npx wrangler d1 migrations apply firefly-cms --remote
npx wrangler deploy
```

`wrangler.jsonc` 中刻意只写 `database_name` 不写 `database_id`，
依赖 wrangler 4.45+ 的自动资源供应，fork 后无需手工建库。

## 内容渲染策略（重要）

正文在**导入/保存时**就用完整的 markdown 管线渲染成 `body_html` 存入 D1，
运行时只输出字符串。这样 Mermaid/PlantUML/KaTeX/Expressive Code 等
依赖 Node 与 WASM 的插件不需要在 workerd 中运行，兼容性风险为零。

修改文章后需重新执行 `npx tsx scripts/d1-import.ts` 生成新 SQL 并 apply，
或在后台保存时由服务端渲染（后台功能落地后启用）。

## 已知限制

- **Worker 体积约 8.9 MB**（已优化：图标白名单 + 移除运行时 markdown 渲染，原为 39.9 MB）。
- **新增图标需重新生成白名单**：在源码或配置中用到新图标后，执行 `pnpm icons`，
  否则 SSR 页面里该图标会缺失。图标集中在 `src/constants/icon-include.json`。
- **免费版 CPU 限制 10 ms**：SSR 渲染较重，若频繁触发 1102 错误需升级 Workers Paid。
- **MDX 不支持**：Live Collections 无法运行 MDX，`mdx-example.mdx` 与 `friends.mdx` 导入时按纯文本处理。
- **Pagefind 已移除**：构建期无 HTML 可索引，搜索改由 D1 提供。
