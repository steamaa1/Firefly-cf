/**
 * 后台会话管理。
 *
 * 用 Astro 内置 sessions（Cloudflare adapter 会自动供应 SESSION KV），
 * 不自己造 Cookie 签名逻辑：KV 存储由平台托管，省去密钥轮换与并发写入问题。
 */
import { getDb } from "@/loaders/d1-core";

/**
 * 仅声明本模块用到的方法，避免依赖 Astro 内部类型路径。
 * 与 Astro 的 AstroSession 结构兼容。
 */
export type SessionLike = {
	get: (key: string) => Promise<unknown>;
	/** Astro 的 session.set / destroy 均为同步返回 void */
	set: (key: string, value: unknown) => void;
	destroy: () => void;
};

export type AdminUser = {
	id: number;
	username: string;
};

const KEY = "admin_user";

/** 读取当前登录用户；会话无效返回 null */
export async function getAdminUser(session: SessionLike | undefined): Promise<AdminUser | null> {
	if (!session) return null;
	try {
		const raw = await session.get(KEY);
		if (!raw || typeof raw !== "object") return null;
		const u = raw as Partial<AdminUser>;
		if (typeof u.id !== "number" || typeof u.username !== "string") return null;
		return { id: u.id, username: u.username };
	} catch {
		return null;
	}
}

export async function setAdminUser(session: SessionLike, user: AdminUser): Promise<void> {
	await session.set(KEY, user);
}

export async function clearAdminUser(session: SessionLike): Promise<void> {
	await session.destroy();
}

/** 是否已有管理员账号；用于首次初始化引导 */
export async function hasAnyAdmin(): Promise<boolean> {
	const db = await getDb();
	const row = await db.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
	return (row?.c ?? 0) > 0;
}
