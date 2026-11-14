# 部署到 Cloudflare Workers

Firefly 是**全站预渲染的纯静态站点**：`astro build` 直接把站点输出到 `dist/`，
Cloudflare Workers 只负责托管这些静态文件。因此**不需要** `@astrojs/cloudflare` adapter，
也不需要配置 Worker 入口（`main`）。

## 架构说明：为什么需要 adapter

当前版本引入后台管理，内容存 D1，公开站通过 Live Collections 在**请求时**读取，
因此需要 `@astrojs/cloudflare` adapter 与 `output: "server"`。

启用 adapter 后产物分为两部分，`wrangler.jsonc` 必须对应配置：

| 产物 | 用途 | 配置项 |
| --- | --- | --- |
| `dist/client` | 静态资源（CSS/图片/字体） | `assets.directory` |
| `dist/server` | Worker 入口（SSR 与 API） | `main` |

> 历史提示：纯静态版本不需要 adapter，产物直接在 `dist/`。
> 若你从旧版本升级而来，注意 `assets.directory` 要从 `./dist` 改为 `./dist/client`，
> 否则会出现整站 404。

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

## 后台管理

访问 `/admin/` 进入后台，当前支持文章的列表 / 新建 / 编辑 / 删除。

### 首次初始化

1. 配置初始化令牌：
   ```bash
   npx wrangler secret put ADMIN_SETUP_TOKEN
   ```
2. 打开 `/admin/login/`，表单会多出「初始化令牌」一栏。
3. 填入用户名、密码与该令牌，即创建第一个管理员。

之后令牌不再参与登录（`users` 表非空时该字段自动隐藏），
避免出现 hardcode 默认密码的常见漏洞。

### 与前台保持一致的实现方式

后台不引入独立 UI 体系，直接复用主站资源：

| 复用项 | 位置 |
| --- | --- |
| HTML 外壳（主题/字体/CSS 变量注入） | `src/layouts/Layout.astro` |
| 卡片与按钮类 | `card-base`、`btn-regular`（`src/styles/main.css`） |
| 主题色与圆角变量 | `--primary`、`--radius-large`、`--card-bg`（`src/styles/variables.styl`） |
| Markdown 预览样式 | `src/styles/markdown.css` |

后台自有样式集中在 `src/styles/admin.css`，仅组合上述变量，不另设配色。

### 技术要点

- **鉴权**：PBKDF2-SHA256（Web Crypto，无原生依赖）+ Astro sessions（SESSION KV 由适配器自动供应）。
- **保存即渲染**：保存文章时把 `body_md` 渲染成 `body_html` 入库，公开站只读 HTML。
- **预览**：`/api/admin/preview` 与保存共用同一个渲染函数，预览与线上效果一致。
