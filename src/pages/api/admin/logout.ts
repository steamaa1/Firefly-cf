/** 后台登出：销毁会话。 */
import type { APIRoute } from "astro";
import { clearAdminUser } from "@/lib/admin/session";

export const prerender = false;

export const POST: APIRoute = async ({ session }) => {
	if (session) await clearAdminUser(session);
	return new Response(JSON.stringify({ ok: true }), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
};
