/**
 * 单篇文章的读取/更新/删除。
 */
import type { APIRoute } from "astro";
import { getAdminUser } from "@/lib/admin/session";
import { deletePost, getPostBySlug, savePost } from "@/lib/admin/posts";

export const prerender = false;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

export const GET: APIRoute = async ({ params, session }) => {
	const user = await getAdminUser(session);
	if (!user) return json({ ok: false, error: "未登录" }, 401);

	const slug = params.slug ?? "";
	const post = await getPostBySlug(slug);
	if (!post) return json({ ok: false, error: "文章不存在" }, 404);
	return json({ ok: true, post });
};

export const PUT: APIRoute = async ({ params, request, session }) => {
	const user = await getAdminUser(session);
	if (!user) return json({ ok: false, error: "未登录" }, 401);

	const originalSlug = params.slug ?? "";
	const existing = await getPostBySlug(originalSlug);
	if (!existing) return json({ ok: false, error: "文章不存在" }, 404);

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ ok: false, error: "请求格式错误" }, 400);
	}

	const slug = String(body.slug ?? originalSlug).trim();
	const title = String(body.title ?? "").trim();
	if (!slug || !title) return json({ ok: false, error: "slug 与标题必填" }, 400);

	try {
		const tags = Array.isArray(body.tags)
			? (body.tags as string[])
			: String(body.tags ?? "")
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean);

		await savePost(
			{
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
				published_at: String(body.published_at ?? "") || existing.published_at,
				tags,
			},
			originalSlug,
		);
		return json({ ok: true, slug });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes("UNIQUE")) return json({ ok: false, error: "slug 已存在" }, 409);
		return json({ ok: false, error: msg }, 500);
	}
};

export const DELETE: APIRoute = async ({ params, session }) => {
	const user = await getAdminUser(session);
	if (!user) return json({ ok: false, error: "未登录" }, 401);

	await deletePost(params.slug ?? "");
	return json({ ok: true });
};
