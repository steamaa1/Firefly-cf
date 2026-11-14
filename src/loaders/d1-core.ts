/**
 * D1 访问基础层。
 *
 * 设计取舍：直接用 `env.DB`（由 src/cloudflare-env.d.ts 声明），
 * 动态 import 是为了让构建期脚本（Node 环境）加载本模块时不报错，
 * 只有真正执行查询时才会触及 cloudflare:workers。
 */
import type { D1Database } from "cloudflare:workers";

export async function getDb(): Promise<D1Database> {
	let mod: { env: { DB?: D1Database } };
	try {
		mod = await import("cloudflare:workers");
	} catch (e) {
		throw new Error(
			`当前环境不支持 cloudflare:workers（通常意味着不在 workerd 中运行）：${String(e)}`,
		);
	}

	const db = mod.env?.DB;
	if (!db) {
		throw new Error(
			"D1 绑定 DB 不存在。请确认 wrangler.jsonc 已配置 d1_databases，并在部署时创建数据库（wrangler 4.45+ 可自动创建）。",
		);
	}
	return db;
}

export function toBool(v: unknown): boolean {
	return v === 1 || v === "1" || v === true;
}

export function toDate(v: unknown): Date {
	if (v instanceof Date) return v;
	return new Date(String(v ?? 0));
}
