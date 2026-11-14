/**
 * 后台预览渲染接口：把 Markdown 渲染成 HTML 供编辑器预览。
 * 与保存时走同一套 markdown 管线，保证预览与最终效果一致。
 */
import type { APIRoute } from "astro";
import { getAdminUser } from "@/lib/admin/session";
import { renderMarkdownPreview } from "@/lib/admin/posts";

export const prerender = false;

export const POST: APIRoute = async ({ request, session }) => {
	const user = await getAdminUser(session);
	if (!user) {
		return new Response(JSON.stringify({ ok: false, error: "未登录" }), {
			status: 401,
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	}

	let body: { body_md?: string };
	try {
		body = (await request.json()) as { body_md?: string };
	} catch {
		return new Response(JSON.stringify({ ok: false, error: "请求格式错误" }), {
			status: 400,
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	}

	try {
		const html = await renderMarkdownPreview(String(body.body_md ?? ""));
		return new Response(JSON.stringify({ ok: true, html }), {
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	} catch (e) {
		return new Response(
			JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
			{ status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
		);
	}
};
