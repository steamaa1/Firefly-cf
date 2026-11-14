/**
 * Astro 中间件：
 * 1. 确保 D1 表结构就绪（移植自 moments-cf 的启动时 AutoMigrate）
 * 2. 捕获渲染异常并把真实错误输出到响应，避免只看到 “[object Object]”
 */
import { defineMiddleware } from "astro:middleware";
import { ensureSchema, ensureSeed } from "@/lib/auto-migrate";

let warned = false;

export const onRequest = defineMiddleware(async (context, next) => {
	// --- 1. 自动建表 + 首次播种示例内容 ---
	try {
		const { env } = await import("cloudflare:workers");
		const db = env?.DB;
		if (db) {
			await ensureSchema(db as Parameters<typeof ensureSchema>[0]);
			// 表建好后若没有任何文章，导入 public/seed.json 的示例内容，
			// 让部署完的站点立刻有内容可看，无需手动执行 SQL。
			const assets = env?.ASSETS;
			if (assets) {
				await ensureSeed(
					db as Parameters<typeof ensureSeed>[0],
					assets as Parameters<typeof ensureSeed>[1],
					context.url.origin,
				);
			}
		}
	} catch (e) {
		if (!warned) {
			warned = true;
			console.warn(`[middleware] 初始化失败：${e instanceof Error ? e.message : String(e)}`);
		}
	}

	// --- 2. 捕获渲染错误并显式输出 ---
	try {
		return await next();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		const stack = e instanceof Error ? e.stack : "";
		console.error("[middleware] 页面渲染失败:", msg, stack);

		// 仅在浏览器直接访问页面时回显错误文本，便于定位；
		// 结构化的 HTML 错误页由 src/pages/500.astro 负责。
		const wantsHtml = (context.request.headers.get("accept") ?? "").includes("text/html");
		if (wantsHtml) {
			return new Response(
				`<!doctype html><meta charset="utf-8"><title>500</title>` +
					`<pre style="font:14px ui-monospace,monospace;white-space:pre-wrap;padding:2rem;background:#1a1a1a;color:#e5e5e5;margin:0;min-height:100vh">` +
					`服务端渲染失败\n\n${escapeHtml(msg)}\n\n${escapeHtml(stack ?? "")}</pre>`,
				{ status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
			);
		}
		return new Response(JSON.stringify({ ok: false, error: msg }), {
			status: 500,
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	}
});

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
