/**
 * 后台文章 CRUD 接口。
 * GET    列表（支持 ?q= 搜索）
 * POST   新建
 */
import type { APIRoute } from "astro";
import { getAdminUser } from "@/lib/admin/session";
import { listPosts, savePost } from "@/lib/admin/posts";

export const prerender = false;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

export const GET: APIRoute = async ({ url, session }) => {
	const user = await getAdminUser(session);
	if (!user) return json({ ok: false, error: "未登录" }, 401);

	try {
		const q = url.searchParams.get("q") ?? undefined;
		const draftOnly = url.searchParams.get("draft") === "1";
		const posts = await listPosts({ query: q, draftOnly });
		// 列表不需要正文，避免响应过大
		const brief = posts.map((p) => ({
			slug: p.slug,
			title: p.title,
			draft: p.draft,
			pinned: p.pinned,
			category: p.category,
			published_at: p.published_at,
			word_count: p.word_count,
		}));
		return json({ ok: true, posts: brief });
	} catch (e) {
		return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
	}
};

export const POST: APIRoute = async ({ request, session }) => {
	const user = await getAdminUser(session);
	if (!user) return json({ ok: false, error: "未登录" }, 401);

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ ok: false, error: "请求格式错误" }, 400);
	}

	const slug = String(body.slug ?? "").trim();
	const title = String(body.title ?? "").trim();
	if (!slug || !title) return json({ ok: false, error: "slug 与标题必填" }, 400);
	if (!/^[a-z0-9][a-z0-9\-_/]*$/i.test(slug)) {
		return json({ ok: false, error: "slug 只能包含字母、数字、-、_、/" }, 400);
	}

	try {
		const tags = Array.isArray(body.tags)
			? (body.tags as string[])
			: String(body.tags ?? "")
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean);

		await savePost({
			slug,
			title,
			description: String(body.description ?? ""),
			body_md: String(body.body_md ?? ""),
			image: String(body.image ?? ""),
			category: String(body.category ?? ""),
			lang: String(body.lang ?? ""),
			pinned: Boolean(body.pinned),
			draft: Boolean(body.draft),
			comment: body.comment === undefined ? true : Boolean(body.comment),
			author: String(body.author ?? ""),
			source_link: String(body.source_link ?? ""),
			license_name: String(body.license_name ?? ""),
			license_url: String(body.license_url ?? ""),
			password: String(body.password ?? ""),
			password_hint: String(body.password_hint ?? ""),
			series: String(body.series ?? ""),
			series_order:
				body.series_order === null || body.series_order === undefined || body.series_order === ""
					? null
					: Number(body.series_order),
			published_at: String(body.published_at ?? "") || undefined,
			tags,
		});
		return json({ ok: true, slug });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes("UNIQUE")) return json({ ok: false, error: "slug 已存在" }, 409);
		return json({ ok: false, error: msg }, 500);
	}
};
