# 部署到 Cloudflare Workers

Firefly 当前版本把内容存放在 **Cloudflare D1**，公开站通过 Astro 的
Live Collections 在请求时读取数据库，后台管理也在同一个 Worker 里运行。
因此需要 `@astrojs/cloudflare` adapter、`output: "server"`，以及一个 **D1 绑定**。

> 历史提示：早期版本是全站预渲染的纯静态站，不需要 adapter，产物直接在 `dist/`。
> 若你从旧版本升级，务必按本文档重新配置，尤其是 `assets.directory`
> 要从 `./dist` 改为 `./dist/client`，否则会整站 404。

## 产物结构与绑定的关系

启用 adapter 后，构建产物分为两部分，`wrangler.jsonc` 必须对应：

| 产物 | 用途 | wrangler 配置 |
| --- | --- | --- |
| `dist/client` | 静态资源（CSS/图片/字体） | `assets.directory` |
| `dist/server` | Worker 入口（SSR 页面与 API） | `main` |

Worker 运行时还需要以下绑定才能工作：

| 绑定 | 类型 | 是否必需 | 用途 |
| --- | --- | --- | --- |
| `DB` | D1 | **必需** | 存放文章、标签、动态、项目、单页与管理员账号 |
| `ASSETS` | Static Assets | 必需 | 由 `assets.binding` 自动生成，用于读取静态资源 |
| `SESSION` | KV | 必需 | 后台登录会话；由适配器自动创建，无需手写配置 |
| `IMAGES` | Images | 可选 | 图片变换；由适配器在部署时自动供应 |

---

## D1 绑定详解

这是本版本最关键的一步，绑定没配好时，公开站会报
「D1 绑定 DB 不存在」，后台则无法登录。

### `wrangler.jsonc` 中的写法

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "firefly",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],

  "main": "@astrojs/cloudflare/entrypoints/server",
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    // 全站按需渲染，dist/client 内没有 HTML，必须让 Worker 优先接管请求
    "run_worker_first": true,
    "not_found_handling": "none"
  },

  "d1_databases": [
    {
      "binding": "DB",                    // 代码里通过 env.DB 访问，勿随意改名
      "database_name": "firefly-cms",     // Cloudflare 上的数据库名
      "migrations_dir": "migrations"      // 迁移脚本目录，供 wrangler d1 migrations 使用
    }
  ]
}
```

三个字段的含义：

- **`binding`**：变量名。代码中通过 `env.DB` 读取（见 `src/loaders/d1-core.ts`），
  改名必须同步改代码。
- **`database_name`**：数据库在 Cloudflare 账号下的名称。
- **`migrations_dir`**：指向本仓库的 `migrations/`，
  让 `wrangler d1 migrations apply` 知道按顺序执行哪些 SQL。

### 为什么没有写 `database_id`

这是刻意省略的。wrangler 4.45.0 起支持**自动资源供应**：
配置里只写 `database_name`，首次 `wrangler deploy` 时会自动在你的账号下创建同名数据库，
并把 ID 回填到配置（或由部署流程注入）。

好处是 fork 后无需手工建库。代价与注意事项：

- 需要用 **wrangler 4.45.0 或更高**（本项目 `package.json` 已锁定 `^4.147.0`）。
- 想手动控制时，可显式填入 ID：

  ```bash
  npx wrangler d1 create firefly-cms
  # 输出会给出 database_id，粘贴到 wrangler.jsonc 对应字段
  ```

- 若账号下已存在同名数据库，自动供应会直接复用，不会重复创建。

### 初始化表结构

数据库建好后是空的，必须执行迁移建表：

```bash
# 本地开发库（写入 .wrangler/ 目录，不影响线上）
npx wrangler d1 migrations apply firefly-cms --local

# 线上库
npx wrangler d1 migrations apply firefly-cms --remote
```

`migrations/0001_init.sql` 会创建 10 张表：

| 表 | 用途 |
| --- | --- |
| `posts` | 文章（含 `body_md` 原文与 `body_html` 渲染结果） |
| `tags` / `post_tags` | 标签与文章的多对多关联 |
| `dynamics` | 动态（微博客） |
| `projects` / `project_tags` | 项目展示与标签 |
| `pages` | 单页（关于、留言板、友链） |
| `users` | 后台管理员账号（密码经 PBKDF2 哈希） |
| `sessions` | 保留表；实际会话由 `SESSION` KV 承载 |
| `settings` | 站点设置预留 |

### 导入初始内容（可选）

仓库自带 14 篇示例文章。`pnpm build` 末尾会运行 `scripts/d1-import.ts`，
从 `src/content/` 读取 Markdown 并生成 `migrations/0002_seed_content.sql`
（该文件已在 `.gitignore` 中，属于生成物）。

导入到线上库：

```bash
npx tsx scripts/d1-import.ts                                    # 生成种子 SQL
npx wrangler d1 execute firefly-cms --remote \
  --file=migrations/0002_seed_content.sql                       # 写入线上库
```

导入时会把 Markdown 预渲染为 HTML 一并写入，因此线上运行时不需要跑 markdown 插件。
不想要示例内容可以不执行这步，直接进后台自己写。

### 验证绑定是否生效

```bash
# 查看线上库的表
npx wrangler d1 execute firefly-cms --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table'"

# 确认文章数
npx wrangler d1 execute firefly-cms --remote \
  --command="SELECT COUNT(*) FROM posts"
```

部署后也可以在 Cloudflare 控制台
**Workers & Pages → 你的 Worker → Settings → Bindings** 里，
确认存在 `DB` 一项且类型为 D1 Database。

### 本地开发

```bash
npx wrangler d1 migrations apply firefly-cms --local
pnpm dev
```

`--local` 会在 `.wrangler/` 下创建 SQLite 副本模拟 D1，
`astro dev` 会使用 Cloudflare Vite 插件在 workerd 中运行，绑定行为与线上一致。
`.wrangler/` 已在 `.gitignore` 中。

### 部署后修改表结构

新增迁移文件（建议命名为 `0003_xxx.sql`），然后按顺序执行：

```bash
npx wrangler d1 migrations apply firefly-cms --local    # 先本地验证
npx wrangler d1 migrations apply firefly-cms --remote   # 再推线上
```

wrangler 会记录已执行的迁移，不会重复应用。

---

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

4. **在首次部署前先建库并应用迁移**（参见上文「初始化表结构」），
   否则 Worker 虽然部署成功，但访问页面会因表不存在而报错。
5. 保存并部署。之后每次 push 到对应分支都会自动重建。

## 方式二：本地命令行部署

```bash
pnpm install
npx wrangler d1 create firefly-cms            # 若用自动供应可跳过
npx wrangler d1 migrations apply firefly-cms --remote
npx wrangler secret put ADMIN_SETUP_TOKEN     # 后台初始化令牌，见下文
pnpm deploy                                   # 等价于 pnpm build && wrangler deploy
```

首次执行 `wrangler` 命令会要求登录 Cloudflare 账号。

## 自定义 Worker 名称

`wrangler.jsonc` 中的 `name` 决定 Worker 名称与默认访问域名
（`<name>.<你的子域>.workers.dev`）。如果已被占用，改成你自己的名字即可：

```jsonc
{
  "name": "my-firefly-blog"
}
```

注意 `name` 与 D1 的 `database_name` 是两回事，后者不需要跟着改。

## 关键配置说明

| 配置 | 作用 |
| --- | --- |
| `main: "@astrojs/cloudflare/entrypoints/server"` | Worker 入口，由适配器提供 |
| `assets.directory: "./dist/client"` | 静态资源目录，必须是 client 子目录 |
| `assets.binding: "ASSETS"` | 让 Worker 能读取静态资源 |
| `assets.run_worker_first: true` | 所有请求先经 Worker。全站 SSR 时必需，否则导航请求会被静态资源拦截 |
| `assets.not_found_handling: "none"` | 关闭 404.html 兜底；SSR 下没有该文件，开启会导致整站异常 |
| `d1_databases[].binding: "DB"` | 代码中 `env.DB` 对应的绑定名 |
| `compatibility_flags: ["nodejs_compat"]` | 构建/运行时的 Node API 兼容 |
| `public/_headers` | 安全响应头 + 静态资源强缓存 |

## 常见问题

**访问页面报「D1 绑定 DB 不存在」**
说明 `wrangler.jsonc` 缺少 `d1_databases` 配置，或配置的 `binding` 不叫 `DB`。
代码固定读取 `env.DB`，改名后需同步修改 `src/loaders/d1-core.ts`。

**页面报「no such table: posts」**
Worker 部署成功但数据库没建表，执行
`npx wrangler d1 migrations apply firefly-cms --remote`。

**部署后整站 404**
检查 `assets.directory` 是否为 `./dist/client`。若误写成 `./dist`，
该目录下只有 client/server 两个子目录，没有 `index.html`。

**搜索没有结果**
当前版本搜索走 `/api/search.json` 查询 D1，不再使用 Pagefind。
若搜不到，确认数据库里有文章且 `draft = 0`、`password = ''`。

**构建时字体下载失败**
Astro Fonts API 会在构建期从 CDN 拉取字体。网络不稳定时重试即可，已下载的字体会缓存在
`node_modules/.astro/fonts/`，重跑会跳过已缓存部分。

---

# 后台管理

访问 `/admin/` 进入后台，当前支持文章的列表 / 新建 / 编辑 / 删除。

## 首次初始化

1. 配置初始化令牌：
   ```bash
   npx wrangler secret put ADMIN_SETUP_TOKEN
   ```
2. 打开 `/admin/login/`，表单会多出「初始化令牌」一栏。
3. 填入用户名、密码与该令牌，即创建第一个管理员。

之后令牌不再参与登录（`users` 表非空时该字段自动隐藏），
避免出现 hardcode 默认密码的常见漏洞。

## 与前台保持一致的实现方式

后台不引入独立 UI 体系，直接复用主站资源：

| 复用项 | 位置 |
| --- | --- |
| HTML 外壳（主题/字体/CSS 变量注入） | `src/layouts/Layout.astro` |
| 卡片与按钮类 | `card-base`、`btn-regular`（`src/styles/main.css`） |
| 主题色与圆角变量 | `--primary`、`--radius-large`、`--card-bg`（`src/styles/variables.styl`） |
| Markdown 预览样式 | `src/styles/markdown.css` |

后台自有样式集中在 `src/styles/admin.css`，仅组合上述变量，不另设配色。

## 技术要点

- **鉴权**：PBKDF2-SHA256（Web Crypto，无原生依赖）+ Astro sessions（`SESSION` KV 由适配器自动供应）。
- **保存即渲染**：保存文章时把 `body_md` 渲染成 `body_html` 入库，公开站只读 HTML。
- **预览**：`/api/admin/preview` 与保存共用同一个渲染函数，预览与线上效果一致。

## 已知限制

- **Worker 体积约 20.7 MB**（gzip 4.9 MB）。相比纯静态版增加的部分来自
  后台编辑器的 Markdown 渲染管线，以及 OG 图使用的 `takumi` WASM（约 3.7 MB）。
  项目使用自定义 `markdown.processor`，Astro 的 `syntaxHighlight.excludeLangs`
  对该路径不生效，因此 Shiki 语言包无法在此裁剪。
- **免费版 CPU 限制 10 ms**：SSR 渲染较重，频繁出现 1102 错误时需升级 Workers Paid。
- **后台目前只管理文章（posts）**：动态、项目、单页尚未提供管理界面。
- **编辑器为纯 textarea + 预览**，未接入富文本或 Markdown 工具栏。
- **MDX 不支持**：Live Collections 无法在运行时渲染 MDX，
  仓库内 `mdx-example.mdx` 与 `friends.mdx` 导入时按纯文本处理。
