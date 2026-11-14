import { getSortedPosts } from "@utils/content-utils";
import { buildAtomFeed, renderFeedEntries } from "@utils/feed-utils";
import type { APIContext } from "astro";
import { profileConfig, siteConfig } from "@/config";
import pkg from "../../package.json";

// 这些接口依赖 D1 内容（文章列表/站点信息），改为运行时生成，
// 保证后台发布后 RSS/Atom/llms.txt 立即可反映最新内容。
export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
	const includeContent = (siteConfig.feed?.contentMode ?? "full") === "full";
	const blog = await getSortedPosts();
	const entries = await renderFeedEntries(blog, { includeContent });
	const site = context.site ?? new URL(siteConfig.site_url);
	const xml = buildAtomFeed({
		site,
		title: siteConfig.title,
		subtitle: siteConfig.subtitle || siteConfig.description || "",
		entries,
		authorName: profileConfig.name,
		generator: `Firefly v${pkg.version}`,
		includeContent,
	});
	return new Response(xml, {
		headers: { "Content-Type": "application/atom+xml; charset=utf-8" },
	});
}
