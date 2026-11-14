/**
 * 后台文章数据访问。
 *
 * 所有写入都在这里完成，公开站只读，职责清晰。
 * 正文渲染：后台保存时把 body_md 交给统一的渲染函数生成 body_html，
 * 使公开站运行时无需任何 markdown 插件。
 */
import { getDb } from "@/loaders/d1-core";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";

export type AdminPost = {
	id: number;
	slug: string;
	title: string;
	description: string;
	body_md: string;
	body_html: string;
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
	tags?: string;
};

export type PostInput = {
	slug: string;
	title: string;
	description?: string;
	body_md?: string;
	image?: string;
	category?: string;
	lang?: string;
	pinned?: boolean;
	draft?: boolean;
	comment?: boolean;
	author?: string;
	source_link?: string;
	license_name?: string;
	license_url?: string;
	password?: string;
	password_hint?: string;
	series?: string;
	series_order?: number | null;
	published_at?: string;
	tags?: string[];
};

let processorPromise: Promise<{ render: (md: string) => Promise<{ code: string }> }> | null = null;

/**
 * 取得 markdown 渲染器。
 *
 * 注意：这会引入 remark/rehype 管线（含 Shiki），仅在后台保存时使用。
 * 公开站的读取路径不引用本模块，因此不会进入公开页面的 bundle。
 */
async function getProcessor() {
	if (!processorPromise) {
		// 使用默认主题与语言集；语言包由 astro.config.mjs 的
		// syntaxHighlight.excludeLangs 统一裁剪，此处无需重复配置。
		processorPromise = createMarkdownProcessor({}) as unknown as Promise<{
			render: (md: string) => Promise<{ code: string }>;
		}>;
	}
	return processorPromise;
}

/** 粗略字数统计：中文按字，英文按词 */
function countWords(md: string): number {
	const plain = md
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/[#*_`>~\-|]/g, " ");
	const cjk = (plain.match(/[\u4e00-\u9fff]/g) ?? []).length;
	const words = plain
		.replace(/[\u4e00-\u9fff]/g, " ")
		.split(/\s+/)
		.filter(Boolean).length;
	return cjk + words;
}

export async function listPosts(opts: { query?: string; draftOnly?: boolean } = {}): Promise<AdminPost[]> {
	const db = await getDb();
	const where: string[] = [];
	const binds: unknown[] = [];

	if (opts.draftOnly) where.push("draft = 1");
	if (opts.query) {
		where.push("(title LIKE ?1 OR slug LIKE ?1)");
		binds.push(`%${opts.query}%`);
	}

	const sql =
		`SELECT id, slug, title, description, body_md, body_html, image, category, lang,
		        pinned, draft, comment, author, source_link, license_name, license_url,
		        password, password_hint, series, series_order, word_count, published_at, updated_at
		 FROM posts` +
		(where.length ? ` WHERE ${where.join(" AND ")}` : "") +
		" ORDER BY published_at DESC, id DESC";

	const stmt = db.prepare(sql);
	const res = await (binds.length ? stmt.bind(...binds) : stmt).all<AdminPost>();
	return res.results;
}

export async function getPostBySlug(slug: string): Promise<AdminPost | null> {
	const db = await getDb();
	const row = await db
		.prepare(
			`SELECT id, slug, title, description, body_md, body_html, image, category, lang,
			        pinned, draft, comment, author, source_link, license_name, license_url,
			        password, password_hint, series, series_order, word_count, published_at, updated_at
			 FROM posts WHERE slug = ?`,
		)
		.bind(slug)
		.first<AdminPost>();
	if (!row) return null;

	const tagRes = await db
		.prepare("SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = ?")
		.bind(row.id)
		.all<{ name: string }>();
	return { ...row, tags: tagRes.results.map((t) => t.name).join(", ") };
}

export async function savePost(input: PostInput, existingSlug?: string): Promise<void> {
	const db = await getDb();
	const processor = await getProcessor();
	const bodyMd = input.body_md ?? "";
	const rendered = await processor.render(bodyMd);
	const words = countWords(bodyMd);
	const publishedAt = input.published_at || new Date().toISOString();

	const common = [
		input.title,
		input.description ?? "",
		bodyMd,
		rendered.code,
		input.image ?? "",
		input.category ?? "",
		input.lang ?? "",
		input.pinned ? 1 : 0,
		input.draft ? 1 : 0,
		input.comment === false ? 0 : 1,
		input.author ?? "",
		input.source_link ?? "",
		input.license_name ?? "",
		input.license_url ?? "",
		input.password ?? "",
		input.password_hint ?? "",
		input.series ?? "",
		input.series_order ?? null,
		words,
		publishedAt,
	];

	if (existingSlug) {
		// 更新：slug 允许修改，需同步文章 id 不变以保证标签关联正确
		await db
			.prepare(
				`UPDATE posts SET slug=?, title=?, description=?, body_md=?, body_html=?, image=?,
				 category=?, lang=?, pinned=?, draft=?, comment=?, author=?, source_link=?,
				 license_name=?, license_url=?, password=?, password_hint=?, series=?,
				 series_order=?, word_count=?, published_at=?, modified_at=datetime('now')
				 WHERE slug=?`,
			)
			.bind(input.slug, ...common, existingSlug)
			.run();
		await syncTags(input.slug, input.tags ?? []);
		return;
	}

	await db
		.prepare(
			`INSERT INTO posts (slug, title, description, body_md, body_html, image, category, lang,
			 pinned, draft, comment, author, source_link, license_name, license_url, password,
			 password_hint, series, series_order, word_count, published_at, modified_at)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
		)
		.bind(input.slug, ...common)
		.run();
	await syncTags(input.slug, input.tags ?? []);
}

/** 重建某篇文章的标签关联（先删后插，自动建新标签） */
async function syncTags(slug: string, tags: string[]): Promise<void> {
	const db = await getDb();
	const row = await db.prepare("SELECT id FROM posts WHERE slug = ?").bind(slug).first<{ id: number }>();
	if (!row) return;

	await db.prepare("DELETE FROM post_tags WHERE post_id = ?").bind(row.id).run();
	for (const raw of tags) {
		const name = raw.trim();
		if (!name) continue;
		await db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").bind(name).run();
		await db
			.prepare(
				"INSERT OR IGNORE INTO post_tags (post_id, tag_id) SELECT ?, id FROM tags WHERE name = ?",
			)
			.bind(row.id, name)
			.run();
	}
}

/** 供编辑器预览调用：渲染 Markdown 为 HTML（不落库） */
export async function renderMarkdownPreview(md: string): Promise<string> {
	const processor = await getProcessor();
	const r = await processor.render(md);
	return r.code;
}

export async function deletePost(slug: string): Promise<void> {
	const db = await getDb();
	await db.prepare("DELETE FROM posts WHERE slug = ?").bind(slug).run();
}
