/**
 * D1 自动建表（移植自 moments-cf 的启动时 AutoMigrate 思路）。
 *
 * 为什么需要：D1 的 `wrangler d1 migrations apply` 是手动步骤，
 * 网页部署的用户没有本地终端，只能去控制台逐条粘贴 SQL，体验极差。
 * 这里改为「首次请求时惰性建表」，部署完直接可用。
 *
 * 设计要点：
 * - 幂等：全部使用 IF NOT EXISTS，重复执行无副作用。
 * - 只跑一次：用模块级 Promise 缓存，同一 isolate 内不重复查询。
 * - 失败不阻塞：建表失败时记录并在下次请求重试，避免整站 500。
 * - 建表后打印到日志，便于在 Cloudflare 的 Logs 里确认。
 */

/** 与 migrations/0001_init.sql 保持一致；改表结构时两处都要更新 */
const SCHEMA_STATEMENTS: string[] = [
	`CREATE TABLE IF NOT EXISTS posts (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		slug          TEXT    NOT NULL UNIQUE,
		title         TEXT    NOT NULL,
		description   TEXT    NOT NULL DEFAULT '',
		body_md       TEXT    NOT NULL DEFAULT '',
		body_html     TEXT    NOT NULL DEFAULT '',
		excerpt       TEXT    NOT NULL DEFAULT '',
		image         TEXT    NOT NULL DEFAULT '',
		category      TEXT,
		lang          TEXT    NOT NULL DEFAULT '',
		pinned        INTEGER NOT NULL DEFAULT 0,
		draft         INTEGER NOT NULL DEFAULT 0,
		comment       INTEGER NOT NULL DEFAULT 1,
		author        TEXT    NOT NULL DEFAULT '',
		source_link   TEXT    NOT NULL DEFAULT '',
		license_name  TEXT    NOT NULL DEFAULT '',
		license_url   TEXT    NOT NULL DEFAULT '',
		password      TEXT    NOT NULL DEFAULT '',
		password_hint TEXT    NOT NULL DEFAULT '',
		series        TEXT    NOT NULL DEFAULT '',
		series_order  INTEGER,
		word_count    INTEGER NOT NULL DEFAULT 0,
		published_at  TEXT    NOT NULL,
		updated_at    TEXT,
		created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
		modified_at   TEXT    NOT NULL DEFAULT (datetime('now'))
	)`,
	`CREATE INDEX IF NOT EXISTS idx_posts_published ON posts (draft, pinned DESC, published_at DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category)`,
	`CREATE INDEX IF NOT EXISTS idx_posts_series ON posts (series)`,

	`CREATE TABLE IF NOT EXISTS tags (
		id   INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE
	)`,

	`CREATE TABLE IF NOT EXISTS post_tags (
		post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
		tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		PRIMARY KEY (post_id, tag_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags (tag_id)`,

	`CREATE TABLE IF NOT EXISTS dynamics (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		slug       TEXT NOT NULL UNIQUE,
		body_md    TEXT NOT NULL DEFAULT '',
		body_html  TEXT NOT NULL DEFAULT '',
		location   TEXT NOT NULL DEFAULT '',
		pinned     INTEGER NOT NULL DEFAULT 0,
		published_at TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	`CREATE INDEX IF NOT EXISTS idx_dynamics_published ON dynamics (pinned DESC, published_at DESC)`,

	`CREATE TABLE IF NOT EXISTS projects (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		slug        TEXT NOT NULL UNIQUE,
		title       TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		body_md     TEXT NOT NULL DEFAULT '',
		body_html   TEXT NOT NULL DEFAULT '',
		image       TEXT NOT NULL DEFAULT '',
		status      TEXT NOT NULL DEFAULT '',
		lang        TEXT NOT NULL DEFAULT '',
		sort_order  INTEGER,
		draft       INTEGER NOT NULL DEFAULT 0,
		published_at TEXT NOT NULL,
		created_at  TEXT NOT NULL DEFAULT (datetime('now'))
	)`,

	`CREATE TABLE IF NOT EXISTS project_tags (
		project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
		tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		PRIMARY KEY (project_id, tag_id)
	)`,

	`CREATE TABLE IF NOT EXISTS pages (
		slug      TEXT PRIMARY KEY,
		body_md   TEXT NOT NULL DEFAULT '',
		body_html TEXT NOT NULL DEFAULT '',
		modified_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,

	`CREATE TABLE IF NOT EXISTS users (
		id            INTEGER PRIMARY KEY AUTOINCREMENT,
		username      TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		created_at    TEXT NOT NULL DEFAULT (datetime('now'))
	)`,

	`CREATE TABLE IF NOT EXISTS sessions (
		id         TEXT PRIMARY KEY,
		user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		expires_at TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at)`,

	`CREATE TABLE IF NOT EXISTS settings (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`,
];

export type D1Like = {
	prepare: (sql: string) => {
		bind: (...v: unknown[]) => { all: <T = unknown>() => Promise<{ results: T[] }>; first: <T = unknown>() => Promise<T | null>; run: () => Promise<unknown> };
		run: () => Promise<unknown>;
		first: <T = unknown>() => Promise<T | null>;
	};
	exec: (sql: string) => Promise<unknown>;
};

/** 同一 isolate 内只执行一次；失败则清空缓存以便下次重试 */
let migratePromise: Promise<void> | null = null;

async function runMigration(db: D1Like): Promise<void> {
	// 先探测是否已建表，已建好就跳过后续 20 条语句
	const probe = await db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='posts'")
		.first<{ name: string }>();

	if (probe?.name === "posts") {
		return;
	}

	console.log("[auto-migrate] 检测到数据库为空，开始建表…");
	for (const stmt of SCHEMA_STATEMENTS) {
		await db.prepare(stmt).run();
	}
	console.log(`[auto-migrate] 建表完成，共执行 ${SCHEMA_STATEMENTS.length} 条语句`);
}

/**
 * 确保表结构就绪。可安全地在每个请求上调用。
 * 建表失败时抛错给调用方决定如何处理，同时清空缓存以便重试。
 */
export async function ensureSchema(db: D1Like): Promise<void> {
	if (!migratePromise) {
		migratePromise = runMigration(db).catch((e) => {
			migratePromise = null;
			throw e;
		});
	}
	return migratePromise;
}

/** 供测试或手动重试用 */
export function resetSchemaCache(): void {
	migratePromise = null;
}

/* ---------------- 首次播种示例内容 ---------------- */

type AssetsBinding = { fetch: (req: Request | string) => Promise<Response> };

let seedPromise: Promise<void> | null = null;

/**
 * 数据库为空时导入 public/seed.json 中的示例内容。
 *
 * 参照 moments-cf 的做法：表为空即写入初始数据，用户部署完就有内容可看。
 * 数据不打进 bundle，而是通过 ASSETS 绑定读取，避免 300KB 进入 Worker 体积。
 * 只导入一次：导入后 posts 表非空，后续请求直接跳过。
 */
async function runSeed(db: D1Like, assets: AssetsBinding, origin: string): Promise<void> {
	const count = await db
		.prepare("SELECT COUNT(*) AS c FROM posts")
		.first<{ c: number }>();

	if ((count?.c ?? 0) > 0) {
		return;
	}

	let statements: string[];
	try {
		const res = await assets.fetch(new URL("/seed.json", origin).toString());
		if (!res.ok) {
			console.warn(`[auto-seed] 未找到 seed.json（${res.status}），跳过示例内容导入`);
			return;
		}
		const payload = (await res.json()) as { statements?: string[] };
		statements = payload.statements ?? [];
	} catch (e) {
		console.warn(`[auto-seed] 读取 seed.json 失败：${e instanceof Error ? e.message : String(e)}`);
		return;
	}

	if (statements.length === 0) {
		console.log("[auto-seed] seed.json 为空，跳过");
		return;
	}

	console.log(`[auto-seed] 数据库为空，开始导入示例内容（${statements.length} 条语句）…`);
	for (const stmt of statements) {
		await db.prepare(stmt).run();
	}
	const after = await db.prepare("SELECT COUNT(*) AS c FROM posts").first<{ c: number }>();
	console.log(`[auto-seed] 导入完成，现有 ${after?.c ?? 0} 篇文章`);
}

export async function ensureSeed(
	db: D1Like,
	assets: AssetsBinding,
	origin: string,
): Promise<void> {
	if (!seedPromise) {
		seedPromise = runSeed(db, assets, origin).catch((e) => {
			seedPromise = null;
			throw e;
		});
	}
	return seedPromise;
}
