import type { APIRoute } from "astro";

// 这些接口依赖 D1 内容（文章列表/站点信息），改为运行时生成，
// 保证后台发布后 RSS/Atom/llms.txt 立即可反映最新内容。
export const prerender = false;

const robotsTxt = `
User-agent: *
Disallow: /_astro/
Disallow: /archive/?tag=
Disallow: /archive/?category=
Disallow: /archive/?uncategorized=

Sitemap: ${new URL("sitemap-index.xml", import.meta.env.SITE).href}
`.trim();

export const GET: APIRoute = () => {
	return new Response(robotsTxt, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
