/**
 * dynamics / projects / pages 三个集合的 Live Loader。
 * 与 posts 同样保持「字段名与原 CollectionEntry 一致」的设计。
 */
import type { LiveLoader } from "astro/loaders";
import { getDb, toBool, toDate } from "./d1-core";

/** Astro 把 getLiveEntry(name, "key") 的字符串转成 { id: "key" } 传入，这里兼容两种写法 */
function pickKey(filter: { id?: string; slug?: string } | undefined): string | undefined {
	const v = filter?.id ?? filter?.slug;
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

/* ---------------- dynamics ---------------- */

export type DynamicData = {
	published: Date;
	pinned: boolean;
	location: string;
};

type DynRow = {
	slug: string;
	body_md: string;
	body_html: string;
	location: string;
	pinned: number;
	published_at: string;
};

export const dynamicsLoader: LiveLoader<DynamicData, { id?: string; slug?: string }> = {
	name: "d1-dynamics",

	async loadCollection() {
		try {
			const db = await getDb();
			const res = await db
				.prepare(
					"SELECT slug, body_md, body_html, location, pinned, published_at FROM dynamics ORDER BY pinned DESC, published_at DESC",
				)
				.all<DynRow>();
			return {
				entries: res.results.map((r) => ({
					id: r.slug,
					data: {
						published: toDate(r.published_at),
						pinned: toBool(r.pinned),
						location: r.location,
					},
					// 原文 Markdown 供 API 提取图片/搜索文本使用
					body: r.body_md,
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
			const key = pickKey(filter);
			if (!key) return undefined;
			const r = await db
				.prepare(
					"SELECT slug, body_md, body_html, location, pinned, published_at FROM dynamics WHERE slug = ?",
				)
				.bind(key)
				.first<DynRow>();
			if (!r) return undefined;
			return {
				id: r.slug,
				data: {
					published: toDate(r.published_at),
					pinned: toBool(r.pinned),
					location: r.location,
				},
				rendered: { html: r.body_html },
			};
		} catch (e) {
			return { error: e instanceof Error ? e : new Error(String(e)) };
		}
	},
};

/* ---------------- projects ---------------- */

export type ProjectLink = { label: string; icon: string; value: string };

export type ProjectData = {
	title: string;
	published: Date;
	draft: boolean;
	order?: number;
	description: string;
	image: string;
	tags: string[];
	link: ProjectLink[];
	status: string;
	lang: string;
};

type ProjRow = {
	id: number;
	slug: string;
	title: string;
	description: string;
	body_html: string;
	image: string;
	status: string;
	lang: string;
	sort_order: number | null;
	draft: number;
	published_at: string;
};

function projToData(r: ProjRow, tags: string[]): ProjectData {
	return {
		title: r.title,
		published: toDate(r.published_at),
		draft: toBool(r.draft),
		order: r.sort_order ?? undefined,
		description: r.description,
		image: r.image,
		tags,
		link: [],
		status: r.status,
		lang: r.lang,
	};
}

export const projectsLoader: LiveLoader<ProjectData, { id?: string; slug?: string }, { publishedOnly?: boolean }> = {
	name: "d1-projects",

	async loadCollection({ filter }) {
		try {
			const db = await getDb();
			const where = filter?.publishedOnly ? " WHERE p.draft = 0" : "";
			const res = await db
				.prepare(
					`SELECT p.id, p.slug, p.title, p.description, p.body_html, p.image, p.status, p.lang, p.sort_order, p.draft, p.published_at
					 FROM projects p${where}
					 ORDER BY p.sort_order IS NULL, p.sort_order DESC, p.published_at DESC`,
				)
				.all<ProjRow>();

			const map = new Map<number, string[]>();
			const ids = res.results.map((r) => r.id);
			if (ids.length) {
				const ph = ids.map(() => "?").join(",");
				const t = await db
					.prepare(
						`SELECT pj.project_id, tg.name FROM project_tags pj JOIN tags tg ON tg.id=pj.tag_id WHERE pj.project_id IN (${ph})`,
					)
					.bind(...ids)
					.all<{ project_id: number; name: string }>();
				for (const row of t.results) {
					const a = map.get(row.project_id) ?? [];
					a.push(row.name);
					map.set(row.project_id, a);
				}
			}

			return {
				entries: res.results.map((r) => ({
					id: r.slug,
					data: projToData(r, map.get(r.id) ?? []),
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
			const key = pickKey(filter);
			if (!key) return undefined;
			const r = await db
				.prepare(
					`SELECT p.id, p.slug, p.title, p.description, p.body_html, p.image, p.status, p.lang, p.sort_order, p.draft, p.published_at
					 FROM projects p WHERE p.slug = ?`,
				)
				.bind(key)
				.first<ProjRow>();
			if (!r) return undefined;
			return {
				id: r.slug,
				data: projToData(r, []),
				rendered: { html: r.body_html },
			};
		} catch (e) {
			return { error: e instanceof Error ? e : new Error(String(e)) };
		}
	},
};

/* ---------------- pages (原 spec 集合) ---------------- */

type PageRow = { slug: string; body_html: string };

export const pagesLoader: LiveLoader<Record<string, never>, { id?: string; slug?: string }> = {
	name: "d1-pages",

	async loadCollection() {
		try {
			const db = await getDb();
			const res = await db
				.prepare("SELECT slug, body_html FROM pages")
				.all<PageRow>();
			return {
				entries: res.results.map((r) => ({
					id: r.slug,
					data: {} as Record<string, never>,
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
			const key = pickKey(filter);
			if (!key) return undefined;
			const r = await db
				.prepare("SELECT slug, body_html FROM pages WHERE slug = ?")
				.bind(key)
				.first<PageRow>();
			if (!r) return undefined;
			return {
				id: r.slug,
				data: {} as Record<string, never>,
				rendered: { html: r.body_html },
			};
		} catch (e) {
			return { error: e instanceof Error ? e : new Error(String(e)) };
		}
	},
};
