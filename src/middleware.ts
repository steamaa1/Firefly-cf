/**
 * Astro 中间件：确保 D1 表结构就绪。
 *
 * 移植自 moments-cf「应用启动时 AutoMigrate」的做法：
 * 部署后无需手动执行迁移，第一次访问任一页面时自动建表。
 *
 * 注意：
 * - 只在检测到 posts 表不存在时才执行建表语句，已建好时只多一次轻量查询。
 * - 建表失败不阻断请求，交由页面自身报错，避免整站 500 且错误信息被掩盖。
 */
import { defineMiddleware } from "astro:middleware";
import { ensureSchema } from "@/lib/auto-migrate";

let warned = false;

export const onRequest = defineMiddleware(async (context, next) => {
	try {
		const { env } = await import("cloudflare:workers");
		const db = env?.DB;
		if (db) {
			await ensureSchema(db as Parameters<typeof ensureSchema>[0]);
		}
	} catch (e) {
		// 只警告一次，避免日志刷屏；真正的数据库错误会在页面查询时暴露
		if (!warned) {
			warned = true;
			console.warn(`[middleware] 自动建表失败：${e instanceof Error ? e.message : String(e)}`);
		}
	}
	return next();
});
