/**
 * Live Collections 配置（Astro 7）。
 *
 * 与 src/content.config.ts 并存：
 * - content.config.ts 的构建期集合保留，供构建期脚本/内容迁移使用。
 * - 这里注册运行时实时读取 D1 的集合，页面用 getLiveCollection()/getLiveEntry() 访问。
 *
 * 之所以用 Live：后台保存后无需重建站点即可生效。
 * 正文在写入时已渲染为 body_html，运行时不做 markdown 处理，
 * 因此不依赖任何 remark/rehype 插件在 workerd 中的兼容性。
 */
import { defineLiveCollection } from "astro:content";
import { postsLoader } from "./loaders/d1-posts";
import {
	dynamicsLoader,
	pagesLoader,
	projectsLoader,
} from "./loaders/d1-others";

const posts: ReturnType<typeof defineLiveCollection> = defineLiveCollection({
	loader: postsLoader,
});
const dynamics: ReturnType<typeof defineLiveCollection> = defineLiveCollection(
	{ loader: dynamicsLoader },
);
const projects: ReturnType<typeof defineLiveCollection> = defineLiveCollection(
	{ loader: projectsLoader },
);
const pages: ReturnType<typeof defineLiveCollection> = defineLiveCollection({
	loader: pagesLoader,
});

export const collections: {
	posts: typeof posts;
	dynamics: typeof dynamics;
	projects: typeof projects;
	pages: typeof pages;
} = {
	posts,
	dynamics,
	projects,
	pages,
};
