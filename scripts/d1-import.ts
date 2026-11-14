/**
 * 把 src/content/ 下的 Markdown 导入 D1（生成 SQL 文件，由 wrangler d1 execute 执行）。
 *
 * 设计要点：
 * - body_html 在导入时用与站点一致的 markdown 管线预渲染，公开站只读 HTML，
 *   因此运行时（workerd）不需要跑任何 remark/rehype 插件。
 * - posts / dynamics / projects / pages 四类内容全部覆盖。
 * - 输出纯 SQL，不依赖 wrangler 登录，便于在 CI 或本地生成后审阅。
 */
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { glob } from "glob";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import { buildRemarkPlugins, buildRehypePlugins } from "../src/utils/markdown-pipeline.ts";

const CONTENT_DIR = "src/content";
const OUT_DIR = "migrations";

type Row = Record<string, string | number | null>;

/** 单引号转义，防止 SQL 注入与语法错误 */
function q(v: string | number | null | undefined): string {
	if (v === null || v === undefined) return "NULL";
	if (typeof v === "number") return String(v);
	return `'${String(v).replace(/'/g, "''")}'`;
}

function b2i(v: unknown): number {
	return v === true || v === "true" ? 1 : 0;
}

function toDateStr(v: unknown): string {
	if (!v) return new Date().toISOString();
	if (v instanceof Date) return v.toISOString();
	return String(v);
}

/**
 * 把文章封面图复制到 public/covers/，并返回站点可访问的绝对路径。
 *
 * 背景：原 frontmatter 里的 image 是相对路径（如 ./images/a.avif），
 * 依赖文章文件的物理位置来解析。内容搬进 D1 后没有文件路径，
 * 相对路径无法解析，封面就显示不出来。
 * 这里在导入时把图片复制到 public 下并改写为固定 URL，
 * 避免依赖构建期生成的带哈希文件名。
 */
const COVER_OUT_DIR = "public/covers";

async function publishCover(rawImage: string, sourceFile: string): Promise<string> {
	const image = (rawImage ?? "").trim();
	if (!image) return "";
	// 外链与已绝对化的路径原样保留
	if (/^https?:\/\//i.test(image) || image.startsWith("/")) return image;

	const dir = path.dirname(sourceFile);
	const abs = path.resolve(dir, image);
	try {
		const buf = await fs.readFile(abs);
		await fs.mkdir(COVER_OUT_DIR, { recursive: true });
		// 用「原目录结构 + 文件名」避免不同文章的同名图片互相覆盖
		const rel = path.relative("src/content", abs).split(path.sep).join("-");
		const outName = rel.replace(/[^a-zA-Z0-9._-]/g, "-");
		await fs.writeFile(path.join(COVER_OUT_DIR, outName), buf);
		return `/covers/${outName}`;
	} catch {
		console.warn(`  ⚠️ 封面图缺失，已跳过：${image}（来自 ${sourceFile}）`);
		return "";
	}
}

async function main() {
	const posts = await glob(`${CONTENT_DIR}/posts/**/*.md`, { nodir: true });
	const mdx = await glob(`${CONTENT_DIR}/posts/**/*.mdx`, { nodir: true });
	const dynamics = await glob(`${CONTENT_DIR}/dynamic/**/*.md`, { nodir: true });
	const projects = await glob(`${CONTENT_DIR}/projects/**/*.md`, { nodir: true });
	const pages = await glob(`${CONTENT_DIR}/spec/**/*.{md,mdx}`, { nodir: true });

	// 关键：必须传入与站点完全一致的插件链。
	// 早前这里用的是 createMarkdownProcessor({})，等于空管线，
	// 导致 KaTeX 公式、代码块框架、callouts、::github 指令、图表
	// 等全部不渲染，线上表现为「Markdown 大片没生效」。
	const processor = await createMarkdownProcessor({
		remarkPlugins: buildRemarkPlugins() as never,
		rehypePlugins: buildRehypePlugins() as never,
	});

	const lines: string[] = [
		"-- 由 scripts/d1-import.ts 自动生成，勿手改",
		"-- 清空内容表后重新导入（保留 users/sessions）",
		"DELETE FROM post_tags;",
		"DELETE FROM project_tags;",
		"DELETE FROM posts;",
		"DELETE FROM dynamics;",
		"DELETE FROM projects;",
		"DELETE FROM pages;",
		"DELETE FROM tags;",
		"",
	];

	let postCount = 0;
	const tagSet = new Set<string>();

	for (const f of [...posts, ...mdx]) {
		const raw = await fs.readFile(f, "utf8");
		const { data, content } = matter(raw);
		const rel = path.relative(`${CONTENT_DIR}/posts`, f).replace(/\.(md|mdx)$/, "");
		const slug = String(data.slug || rel);
		const isMdx = f.endsWith(".mdx");

		// MDX 无法在运行时渲染，这里标记为需要构建期处理的纯文本
		const bodyMd = isMdx
			? `<!-- 该文章原为 MDX，导入时未解析 JSX/import -->\n${content}`
			: content;

		const htmlPosts = await processor.render(bodyMd);
		// 封面图相对路径在 D1 场景下无法解析，导入时发布到 public/ 并改写
		const coverUrl = await publishCover(String(data.image ?? ""), f);

		lines.push(
			`INSERT INTO posts (slug,title,description,body_md,body_html,excerpt,image,category,lang,pinned,draft,comment,author,source_link,license_name,license_url,password,password_hint,series,series_order,word_count,published_at,updated_at) VALUES (` +
				[
					q(slug),
					q(String(data.title ?? "")),
					q(String(data.description ?? "")),
					q(bodyMd),
					q(htmlPosts.code),
					q(String(data.description ?? "").slice(0, 200)),
					q(coverUrl),
					q(data.category ?? ""),
					q(String(data.lang ?? "")),
					b2i(data.pinned),
					b2i(data.draft),
					data.comment === false ? 0 : 1,
					q(String(data.author ?? "")),
					q(String(data.sourceLink ?? "")),
					q(String(data.licenseName ?? "")),
					q(String(data.licenseUrl ?? "")),
					q(String(data.password ?? "")),
					q(String(data.passwordHint ?? "")),
					q(String(data.series ?? "")),
					data.seriesOrder === undefined ? "NULL" : String(Number(data.seriesOrder)),
					String(content.trim().split(/\s+/).filter(Boolean).length),
					q(toDateStr(data.published)),
					data.updated ? q(toDateStr(data.updated)) : "NULL",
				].join(",") +
				");",
		);

		for (const t of (data.tags ?? []) as string[]) {
			tagSet.add(String(t));
		}
		postCount++;
	}

	// tags + post_tags
	for (const t of tagSet) {
		lines.push(`INSERT OR IGNORE INTO tags (name) VALUES (${q(t)});`);
	}
	for (const f of [...posts, ...mdx]) {
		const raw = await fs.readFile(f, "utf8");
		const { data } = matter(raw);
		const rel = path.relative(`${CONTENT_DIR}/posts`, f).replace(/\.(md|mdx)$/, "");
		const slug = String(data.slug || rel);
		for (const t of (data.tags ?? []) as string[]) {
			lines.push(
				`INSERT OR IGNORE INTO post_tags (post_id, tag_id) SELECT p.id, t.id FROM posts p, tags t WHERE p.slug = ${q(slug)} AND t.name = ${q(String(t))};`,
			);
		}
	}

	let dynCount = 0;
	for (const f of dynamics) {
		const raw = await fs.readFile(f, "utf8");
		const { data, content } = matter(raw);
		const slug = path.basename(f).replace(/\.md$/, "");
		const htmlDyn = await processor.render(content);
		lines.push(
			`INSERT INTO dynamics (slug,body_md,body_html,location,pinned,published_at) VALUES (` +
				[
					q(slug),
					q(content),
					q(htmlDyn.code),
					q(String(data.location ?? "")),
					b2i(data.pinned),
					q(toDateStr(data.published)),
				].join(",") +
				");",
		);
		dynCount++;
	}

	let projCount = 0;
	for (const f of projects) {
		const raw = await fs.readFile(f, "utf8");
		const { data, content } = matter(raw);
		const rel = path.relative(`${CONTENT_DIR}/projects`, f).replace(/\.(md|mdx)$/, "");
		const slug = String(data.slug || rel);
		const htmlProj = await processor.render(content);
		const projCover = await publishCover(String(data.image ?? ""), f);
		lines.push(
			`INSERT INTO projects (slug,title,description,body_md,body_html,image,status,lang,sort_order,draft,published_at) VALUES (` +
				[
					q(slug),
					q(String(data.title ?? "")),
					q(String(data.description ?? "")),
					q(content),
					q(htmlProj.code),
					q(projCover),
					q(String(data.status ?? "")),
					q(String(data.lang ?? "")),
					data.order === undefined ? "NULL" : String(Number(data.order)),
					b2i(data.draft),
					q(toDateStr(data.published)),
				].join(",") +
				");",
		);
		projCount++;
	}

	let pageCount = 0;
	for (const f of pages) {
		const raw = await fs.readFile(f, "utf8");
		const { content } = matter(raw);
		const slug = path.basename(f).replace(/\.(md|mdx)$/, "");
		const htmlPage = await processor.render(content);
		lines.push(
			`INSERT INTO pages (slug,body_md,body_html) VALUES (${q(slug)},${q(content)},${q(htmlPage.code)});`,
		);
		pageCount++;
	}

	await fs.mkdir(OUT_DIR, { recursive: true });
	const outFile = path.join(OUT_DIR, "0002_seed_content.sql");
	await fs.writeFile(outFile, lines.join("\n") + "\n", "utf8");

	// 同时输出一份 JSON 到 public/，供 Worker 在「数据库为空」时自动播种。
	// 放在 public/ 而不是打进 bundle，是为了避免 300KB 的示例内容进入 Worker 体积，
	// 运行时通过 env.ASSETS 读取即可。
	// 只保留 INSERT/建索引类语句：自动播种仅在空库时触发，
	// 若保留脚本开头的 DELETE 清理语句，并发首次访问时可能误删刚写入的数据。
	const seedPayload = {
		generatedAt: new Date().toISOString(),
		statements: lines.filter(
			(l) => l.trim() && !l.startsWith("--") && !/^\s*DELETE\s/i.test(l),
		),
	};
	// 不缩进输出：seed.json 只由服务端读取，体积从 ~1.6MB 降到约一半，
	// 减少静态资源占用与部署时间。
	await fs.mkdir("public", { recursive: true });
	await fs.writeFile(
		path.join("public", "seed.json"),
		JSON.stringify(seedPayload),
		"utf8",
	);

	console.log(
		`✅ 导出 ${outFile} 与 public/seed.json\n   posts=${postCount} dynamics=${dynCount} projects=${projCount} pages=${pageCount} tags=${tagSet.size}`,
	);
}

main().catch((e) => {
	console.error("导入失败:", e);
	process.exit(1);
});
