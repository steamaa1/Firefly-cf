/**
 * 读取服务端环境变量（兼容多种来源）。
 *
 * Cloudflare 上环境变量有两个易混点：
 * 1. 控制台的「变量」与「密钥」是不同类型，但最终都会进 Worker 的 env；
 * 2. Astro 适配器把 Worker env 注册到 astro:env，直接读 cloudflare:workers
 *    在部分时机可能拿到空值。
 *
 * 这里按优先级依次尝试，任一成功即返回，避免因来源差异导致读不到。
 */

export type EnvReadResult = {
	value: string | undefined;
	/** 实际生效的来源，便于排查 */
	source: "cloudflare:workers" | "astro:env" | "process.env" | "none";
	/** 环境里可见的键名（仅日志用，不返回值） */
	availableKeys: string[];
};

export async function readEnv(key: string): Promise<EnvReadResult> {
	const availableKeys: string[] = [];

	// 1) 首选 cloudflare:workers（Worker 运行时绑定与 secret 的真实来源）
	try {
		const mod = (await import("cloudflare:workers")) as unknown as {
			env?: Record<string, unknown>;
		};
		const env = mod.env;
		if (env) {
			availableKeys.push(...Object.keys(env));
			const v = env[key];
			if (typeof v === "string" && v.length > 0) {
				return { value: v, source: "cloudflare:workers", availableKeys };
			}
		}
	} catch {
		// 非 workerd 环境（如构建期）会抛错，忽略
	}

	// 2) Astro 的 env 适配层
	try {
		const mod = (await import("astro:env/server")) as Record<string, unknown>;
		const v = mod[key];
		if (typeof v === "string" && v.length > 0) {
			return { value: v, source: "astro:env", availableKeys };
		}
	} catch {
		// 未在 env schema 中声明时会失败，忽略
	}

	// 3) Node 的 process.env（本地 dev 与 .dev.vars 场景）
	const pv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
		?.env?.[key];
	if (typeof pv === "string" && pv.length > 0) {
		return { value: pv, source: "process.env", availableKeys };
	}

	return { value: undefined, source: "none", availableKeys };
}
