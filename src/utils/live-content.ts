/**
 * Live Collections 的轻量适配层。
 *
 * getLiveCollection/getLiveEntry 返回 { entries | entry, error }，
 * 而项目原有代码按 getCollection/getEntry 的返回值书写。
 * 这里把解包与错误处理集中起来，避免在每个调用点重复写 try/catch，
 * 同时把 D1 故障转成显式异常，方便在 Worker 日志里定位。
 */
import {
	getLiveCollection,
	getLiveEntry,
} from "astro:content";

export type LiveEntryLike<T, C extends string = string> = {
	id: string;
	data: T;
	/** 集合名，保持与 CollectionEntry 一致的形状，便于复用处类型兼容 */
	collection: C;
	/** 原始 Markdown 原文（部分 loader 提供，供搜索文本/图片提取使用） */
	body?: string;
	/**
	 * 原文件路径。D1 内容没有真实文件，这里始终为 undefined；
	 * 保留该字段是为了让调用方（图片路径解析等）的类型与原 CollectionEntry 兼容。
	 */
	filePath?: string;
	rendered?: { html: string };
};

function fail(scope: string, error: unknown): never {
	const msg = error instanceof Error ? error.message : String(error);
	throw new Error(`[live-content] ${scope} 失败：${msg}`);
}

/**
 * 取一个 Live 集合的全部条目。
 * filter 直接透传给 loader（posts 支持 publishedOnly/category/tag/series）。
 */
export async function liveCollection<T, C extends string = string>(
	name: "posts" | "dynamics" | "projects" | "pages",
	filter?: Record<string, unknown>,
): Promise<LiveEntryLike<T, C>[]> {
	const res = await getLiveCollection(name as never, filter as never);
	if (res.error) fail(name, res.error);
	const entries = (res.entries ?? []) as unknown as Array<Record<string, unknown>>;
	return entries.map((e) => ({ ...e, collection: name })) as unknown as LiveEntryLike<T, C>[];
}

/** 取单个条目，找不到返回 undefined（与 getEntry 行为一致） */
export async function liveEntry<T, C extends string = string>(
	name: "posts" | "dynamics" | "projects" | "pages",
	id: string,
): Promise<LiveEntryLike<T, C> | undefined> {
	const res = await getLiveEntry(name as never, id as never);
	if (res.error) {
		// 未找到不算错误，交给调用方按 undefined 处理
		const msg = res.error instanceof Error ? res.error.message : String(res.error);
		if (msg.includes("not found") || msg.includes("Not Found")) return undefined;
		fail(`${name}/${id}`, res.error);
	}
	const found = res.entry as unknown as Record<string, unknown> | undefined;
	return found ? ({ ...found, collection: name } as unknown as LiveEntryLike<T, C>) : undefined;
}
