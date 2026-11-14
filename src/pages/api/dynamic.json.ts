import { liveCollection } from "@utils/live-content";
import type { DynamicData } from "@/loaders/d1-others";
import {
	dynamicSearchText,
	dynamicSlug,
	sortDynamics,
} from "@/utils/dynamic-utils";

const markdownImagePattern = /!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g;

export async function GET(): Promise<Response> {
	const dynamics = sortDynamics(
		await liveCollection<DynamicData, "dynamic">("dynamics"),
	);
	// 正文已在写入 D1 时渲染为 body_html，这里不再调用 markdown 处理器。
	// 这样可以避免把整套 remark/rehype + Shiki 语言包打进 Worker bundle
	// （实测可减少约 40MB，显著改善冷启动）。
	const data = dynamics.map((entry) => {
		const images: Array<{ alt: string; src: string; title?: string }> = [];
		// 仅从原始 Markdown 中提取图片信息，不参与渲染
		(entry.body || "").replace(
			markdownImagePattern,
			(_match, alt: string, src: string, title?: string) => {
				images.push({ alt, src, ...(title ? { title } : {}) });
				return "";
			},
		);

		return {
			id: dynamicSlug(entry.id),
			published: entry.data.published.getTime(),
			html: entry.rendered?.html ?? "",
			images,
			searchText: dynamicSearchText(entry),
			pinned: entry.data.pinned || false,
			location: entry.data.location.trim(),
		};
	});

	return new Response(JSON.stringify(data), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
		},
	});
}
