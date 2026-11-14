/**
 * 站点统一的 Markdown 渲染管线。
 *
 * 为什么要抽出来：
 * astro.config.mjs 里原本内联定义了完整的 remark/rehype 插件链，
 * 而 scripts/d1-import.ts 在导入内容时用 `createMarkdownProcessor({})`，
 * 得到的是一个「空管线」，于是 KaTeX 公式、代码块框架、callouts、
 * directive（如 ::github）、图表等全部不会被渲染。
 *
 * 这里把插件清单收拢为单一来源，astro.config.mjs 与导入脚本共用，
 * 保证「导入时渲染的结果」与「站点构建时的渲染」完全一致。
 */
import { unified } from "@astrojs/markdown-remark";
import katex from "katex";
import "katex/dist/contrib/mhchem.mjs";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeCallouts from "rehype-callouts";
import rehypeCodeGroup from "rehype-code-group";
import rehypeComponents from "rehype-components";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkAdmonitionToBlockquoteCallout from "remark-admonition-to-blockquote-callout";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import remarkSectionize from "remark-sectionize";
import { mermaidConfig, plantumlConfig, siteConfig } from "@/config";
import { GithubCardComponent } from "@/plugins/rehype-component-github-card.mjs";
import { rehypeDiagramPanZoom } from "@/plugins/rehype-diagram-panzoom.mjs";
import rehypeEmailProtection from "@/plugins/rehype-email-protection.mjs";
import rehypeExternalLinks from "@/plugins/rehype-external-links.mjs";
import rehypeFigure from "@/plugins/rehype-figure.mjs";
import rehypeImageReferrerPolicy from "@/plugins/rehype-image-referrerpolicy.mjs";
import { rehypeMermaid } from "@/plugins/rehype-mermaid.mjs";
import { rehypePlantuml } from "@/plugins/rehype-plantuml.mjs";
import { parseDirectiveNode } from "@/plugins/remark-directive-rehype.js";
import { remarkExcerpt } from "@/plugins/remark-excerpt.js";
import { remarkImageGrid } from "@/plugins/remark-image-grid.js";
import { remarkMermaid } from "@/plugins/remark-mermaid.js";
import { remarkPlantuml } from "@/plugins/remark-plantuml.js";
import { remarkReadingTime } from "@/plugins/remark-reading-time.mjs";
import { remarkWikiLink } from "@/plugins/remark-wiki-link.js";

/**
 * 插件数组的类型。
 * 这里用 unknown[] 而不是引入 unified/rehype 的私有类型：
 * `--isolatedDeclarations` 要求显式可命名的返回类型，而这些插件的选项类型
 * 来自各包内部路径（rehype-components/Options 等），直接引用会让声明文件不可移植。
 */
export type MarkdownPluginList = unknown[];

/** remark 插件链（顺序与站点保持一致，改动会同时影响导入与构建） */
export function buildRemarkPlugins(): MarkdownPluginList {
	return [
		...(siteConfig.post.rehypeCallouts.enablePythonMarkdownAdmonitions !== false
			? [remarkAdmonitionToBlockquoteCallout]
			: []),
		remarkMath,
		remarkReadingTime,
		remarkWikiLink,
		remarkImageGrid,
		remarkExcerpt,
		remarkDirective,
		remarkSectionize,
		parseDirectiveNode,
		remarkMermaid,
		[remarkPlantuml, plantumlConfig] as const,
	];
}

/** rehype 插件链 */
export function buildRehypePlugins(): MarkdownPluginList {
	return [
		[rehypeKatex, { katex }] as const,
		[rehypeCallouts, { theme: siteConfig.post.rehypeCallouts.theme }] as const,
		rehypeSlug,
		rehypeCodeGroup,
		[rehypeMermaid, mermaidConfig] as const,
		rehypePlantuml,
		rehypeDiagramPanZoom,
		rehypeFigure,
		[
			rehypeImageReferrerPolicy,
			{ domains: siteConfig.imageOptimization?.noReferrerDomains || [] },
		] as const,
		[rehypeExternalLinks, { siteUrl: siteConfig.site_url }] as const,
		[rehypeEmailProtection, { method: "base64" }] as const,
		[
			rehypeComponents,
			{ components: { github: GithubCardComponent } },
		] as const,
		[
			rehypeAutolinkHeadings,
			{
				behavior: "append",
				properties: { className: ["anchor"] },
				content: {
					type: "element",
					tagName: "span",
					properties: {
						className: ["anchor-icon"],
						"data-pagefind-ignore": true,
					},
					children: [{ type: "text", value: "#" }],
				},
			},
		] as const,
	];
}

/** 构造与站点一致的 unified 处理器（供 astro.config 使用） */
export function buildMarkdownProcessor(): unknown {
	return unified({
		remarkPlugins: buildRemarkPlugins() as never,
		rehypePlugins: buildRehypePlugins() as never,
	});
}
