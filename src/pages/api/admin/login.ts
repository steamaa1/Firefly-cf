/**
 * 后台登录接口。
 *
 * 首次部署时若 users 表为空，用 ADMIN_SETUP_TOKEN 环境变量完成初始化，
 * 避免「默认密码」这种常见漏洞。之后必须用真实账号密码登录。
 */
import type { APIRoute } from "astro";
import { getDb } from "@/loaders/d1-core";
import { hashPassword, verifyPassword } from "@/lib/admin/password";
import { setAdminUser } from "@/lib/admin/session";
import { env } from "cloudflare:workers";

export const prerender = false;

type Body = { username?: string; password?: string; setupToken?: string };

export const POST: APIRoute = async ({ request, session }) => {
	if (!session) {
		return json({ ok: false, error: "当前环境不支持会话" }, 500);
	}

	let body: Body;
	try {
		body = (await request.json()) as Body;
	} catch {
		return json({ ok: false, error: "请求格式错误" }, 400);
	}

	const username = (body.username ?? "").trim();
	const password = body.password ?? "";
	if (!username || !password) {
		return json({ ok: false, error: "用户名和密码不能为空" }, 400);
	}

	const db = await getDb();
	const count = await db.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
	const isEmpty = (count?.c ?? 0) === 0;

	if (isEmpty) {
		// 首次初始化：必须提供正确的 ADMIN_SETUP_TOKEN
		const expected = env.ADMIN_SETUP_TOKEN;
		if (!expected) {
			return json(
				{ ok: false, error: "服务端未设置 ADMIN_SETUP_TOKEN，无法初始化管理员" },
				500,
			);
		}
		if ((body.setupToken ?? "") !== expected) {
			return json({ ok: false, error: "初始化令牌不正确" }, 403);
		}
		const hash = await hashPassword(password);
		await db
			.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
			.bind(username, hash)
			.run();
		const created = await db
			.prepare("SELECT id, username FROM users WHERE username = ?")
			.bind(username)
			.first<{ id: number; username: string }>();
		if (!created) return json({ ok: false, error: "创建管理员失败" }, 500);

		await setAdminUser(session, created);
		return json({ ok: true, initialized: true, username: created.username });
	}

	const user = await db
		.prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
		.bind(username)
		.first<{ id: number; username: string; password_hash: string }>();

	if (!user) return json({ ok: false, error: "用户名或密码错误" }, 401);

	const valid = await verifyPassword(password, user.password_hash);
	if (!valid) return json({ ok: false, error: "用户名或密码错误" }, 401);

	await setAdminUser(session, { id: user.id, username: user.username });
	return json({ ok: true, username: user.username });
};

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}
