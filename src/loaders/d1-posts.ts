/**
 * posts 集合的 Live Loader。
 *
 * 目标：让 getLiveCollection("posts") 返回的条目形状与原先
 * getCollection("posts") 的 CollectionEntry 保持一致，从而把上层
 * 改动面压到最小（只改取数函数名，不改字段访问方式）。
 */
import type { LiveLoader } from "astro/loaders";
import { getDb, toBool, toDate } from "./d1-core";

export type PostData = {
	title: string;
	published: Date;
	updated?: Date;
	draft: boolean;
	description: string;
	image: string;
	tags: string[];
	category: string | null;
	lang: string;
	pinned: boolean;
	author: string;
	sourceLink: string;
	licenseName: string;
	licenseUrl: string;
	comment: boolean;
	password: string;
	passwordHint: string;
	series: string;
	seriesOrder?: number;
	prevTitle: string;
	prevSlug: string;
	nextTitle: string;
	nextSlug: string;
};

type PostRow = {
	id: number;
	slug: string;
	title: string;
	description: string;
	body_html: string;
	excerpt: string;
	image: string;
	category: string | null;
	lang: string;
	pinned: number;
	draft: number;
	comment: number;
	author: string;
	source_link: string;
	license_name: string;
	license_url: string;
	password: string;
	password_hint: string;
	series: string;
	series_order: number | null;
	word_count: number;
	published_at: string;
	updated_at: string | null;
};

export type PostFilter = {
	/** 仅取已发布（非草稿） */
	publishedOnly?: boolean;
	/** 按分类过滤 */
	category?: string | null;
	/** 按标签过滤 */
	tag?: string;
	/** 按系列过滤 */
	series?: string;
};

/** 从 Astro 传入的 filter 中取出主键：兼容 { id } 与 { slug } 两种形式 */
function pickKey(filter: { id?: string; slug?: string } | undefined): string | undefined {
	const v = filter?.id ?? filter?.slug;
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

const SELECT_BASE = `
	SELECT p.id, p.slug, p.title, p.description, p.body_html, p.excerpt, p.image,
	       p.category, p.lang, p.pinned, p.draft, p.comment, p.author,
	       p.source_link, p.license_name, p.license_url, p.password, p.password_hint,
	       p.series, p.series_order, p.word_count, p.published_at, p.updated_at
	FROM posts p
`;

function rowToData(r: PostRow, tags: string[]): PostData {
	return {
		title: r.title,
		published: toDate(r.published_at),
		updated: r.updated_at ? toDate(r.updated_at) : undefined,
		draft: toBool(r.draft),
		description: r.description,
		image: r.image,
		tags,
		category: r.category,
		lang: r.lang,
		pinned: toBool(r.pinned),
		author: r.author,
		sourceLink: r.source_link,
		licenseName: r.license_name,
		licenseUrl: r.license_url,
		comment: toBool(r.comment),
		password: r.password,
		passwordHint: r.password_hint,
		series: r.series,
		seriesOrder: r.series_order ?? undefined,
		prevTitle: "",
		prevSlug: "",
		nextTitle: "",
		nextSlug: "",
	};
}

/** 批量取标签，避免 N+1 */
async function loadTagsFor(db: Awaited<ReturnType<typeof getDb>>, ids: number[]) {
	const map = new Map<number, string[]>();
	if (ids.length === 0) return map;
	const placeholders = ids.map(() => "?").join(",");
	const res = await db
		.prepare(
			`SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id IN (${placeholders})`,
		)
		.bind(...ids)
		.all<{ post_id: number; name: string }>();
	for (const row of res.results) {
		const arr = map.get(row.post_id) ?? [];
		arr.push(row.name);
		map.set(row.post_id, arr);
	}
	return map;
}

export const postsLoader: LiveLoader<PostData, { id?: string; slug?: string }, PostFilter> = {
	name: "d1-posts",

	async loadCollection({ filter }) {
		try {
			const db = await getDb();
			const where: string[] = [];
			const binds: unknown[] = [];

			if (filter?.publishedOnly) where.push("p.draft = 0");
			if (filter?.category !== undefined && filter.category !== null) {
				where.push("p.category = ?");
				binds.push(filter.category);
			}
			if (filter?.series) {
				where.push("p.series = ?");
				binds.push(filter.series);
			}
			if (filter?.tag) {
				where.push(
					"p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE t.name = ?)",
				);
				binds.push(filter.tag);
			}

			const sql =
				SELECT_BASE +
				(where.length ? ` WHERE ${where.join(" AND ")}` : "") +
				" ORDER BY p.pinned DESC, p.published_at DESC";

			const stmt = db.prepare(sql);
			const res = await (binds.length ? stmt.bind(...binds) : stmt).all<PostRow>();

			const tagMap = await loadTagsFor(db, res.results.map((r) => r.id));

			return {
				entries: res.results.map((r) => ({
					id: r.slug,
					data: rowToData(r, tagMap.get(r.id) ?? []),
					rendered: { html: r.body_html },
				})),
			};
		} catch (e) {
			return { error: e instanceof Error ? e : new Error(String(e)) };
		}
	},

	async loadEntry({ filter }) {
		try {
			const db = await getDb();
			// Astro 把 getLiveEntry(name, "slug") 的字符串参数转成 { id: "slug" } 传入，
			// 因此这里同时兼容 id 与 slug 两种写法，避免绑定到 undefined 触发 D1_TYPE_ERROR。
			const key = pickKey(filter);
			if (!key) return undefined;
			const row = await db
				.prepare(SELECT_BASE + " WHERE p.slug = ?")
				.bind(key)
				.first<PostRow>();
			if (!row) return undefined;

			const tagRes = await db
				.prepare(
					"SELECT t.name FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id = ?",
				)
				.bind(row.id)
				.all<{ name: string }>();

			return {
				id: row.slug,
				data: rowToData(row, tagRes.results.map((t) => t.name)),
				rendered: { html: row.body_html },
			};
		} catch (e) {
			return { error: e instanceof Error ? e : new Error(String(e)) };
		}
	},
};
