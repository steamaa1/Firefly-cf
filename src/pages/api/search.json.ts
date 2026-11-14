/**
 * 搜索接口：替代 Pagefind。
 *
 * 为什么需要替代：Pagefind 依赖构建期扫描 dist/*.html 生成索引，
 * 而本站已改为运行时渲染（Live Collections 读 D1），构建期不存在 HTML，
 * 索引必然为空。这里改用 D1 做关键词检索。
 *
 * 检索策略：
 * - 标题、描述、正文纯文本按关键词匹配（LIKE，大小写不敏感）。
 * - 密码保护的文章不参与检索，避免泄露标题/摘要。
 * - 返回结构与前端搜索结果组件所需字段对齐。
 */
import type { APIRoute } from "astro";
import { getDb } from "@/loaders/d1-core";

export const prerender = false;

type SearchRow = {
	slug: string;
	title: string;
	description: string;
	category: string | null;
	published_at: string;
	snippet: string;
};

/** 从 HTML 中剥离标签，得到用于摘要的纯文本 */
function stripHtml(html: string): string {
	return html
		.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** 截取关键词附近的片段，便于前端高亮上下文 */
function makeSnippet(text: string, keyword: string, radius = 60): string {
	const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
	if (idx < 0) return text.slice(0, radius * 2);
	const start = Math.max(0, idx - radius);
	const end = Math.min(text.length, idx + keyword.length + radius);
	return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export const GET: APIRoute = async ({ url }) => {
	const keyword = (url.searchParams.get("q") ?? "").trim();
	const limitRaw = Number(url.searchParams.get("limit") ?? "20");
	const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

	if (!keyword) {
		return new Response(JSON.stringify({ keyword, results: [] }), {
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	}

	try {
		const db = await getDb();
		// 密码保护的文章不出现在搜索结果中
		const like = `%${keyword}%`;
		const res = await db
			.prepare(
				`SELECT slug, title, description, category, published_at,
				        substr(body_html, 1, 4000) AS snippet
				 FROM posts
				 WHERE draft = 0
				   AND password = ''
				   AND (title LIKE ?1 OR description LIKE ?1 OR body_html LIKE ?1)
				 ORDER BY pinned DESC, published_at DESC
				 LIMIT ?2`,
			)
			.bind(like, limit)
			.all<SearchRow>();

		const results = res.results.map((r) => {
			const plain = stripHtml(r.snippet);
			return {
				slug: r.slug,
				title: r.title,
				description: r.description,
				category: r.category ?? "",
				published: r.published_at,
				excerpt: makeSnippet(plain, keyword),
			};
		});

		return new Response(JSON.stringify({ keyword, results }), {
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	} catch (e) {
		return new Response(
			JSON.stringify({
				keyword,
				results: [],
				error: e instanceof Error ? e.message : String(e),
			}),
			{ status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
		);
	}
};
