/**
 * Cloudflare 运行时绑定类型。
 *
 * 独立于 env.d.ts，避免覆盖项目已有的全局声明。
 *
 * 这里手写而不依赖 `wrangler types` 生成，原因：
 * 1. 生成命令需启动 workerd，在部分环境（如 Android/proot ARM64）会直接崩溃；
 * 2. fork 者无需额外执行生成步骤即可通过类型检查。
 * 若绑定形状变化，同步修改本文件即可。
 */
declare module "cloudflare:workers" {
	export interface D1PreparedStatement {
		bind(...values: unknown[]): D1PreparedStatement;
		all<T = unknown>(): Promise<{ results: T[] }>;
		first<T = unknown>(): Promise<T | null>;
		run(): Promise<unknown>;
	}

	export interface D1Database {
		prepare(sql: string): D1PreparedStatement;
		batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
		exec(sql: string): Promise<unknown>;
	}

	export interface R2Bucket {
		get(key: string): Promise<unknown>;
		put(key: string, value: unknown, options?: unknown): Promise<unknown>;
		delete(key: string): Promise<void>;
		list(options?: unknown): Promise<{ objects: Array<{ key: string }> }>;
	}

	export interface Env {
		DB: D1Database;
		ASSETS: { fetch(request: Request): Promise<Response> };
		MEDIA?: R2Bucket;
		/** 后台管理员初始化密钥；仅用于首次创建管理员账号 */
		ADMIN_SETUP_TOKEN?: string;
		/** 会话签名密钥 */
		SESSION_SECRET?: string;
	}

	export const env: Env;
}
