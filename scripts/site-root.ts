import { existsSync } from "node:fs";

/**
 * 构建产物根目录。
 *
 * Firefly 是全站预渲染的纯静态站点，`astro build` 直接把站点输出到 `dist/`，
 * Cloudflare Workers 也以 `dist/` 作为静态资源目录（见 wrangler.jsonc）。
 *
 * 兜底：若历史构建残留或自行启用了 @astrojs/cloudflare adapter，
 * 产物会变成 `dist/client` + `dist/server`，此时仍优先取 `dist/client`，
 * 避免页脚索引、字体子集等后处理脚本把文件写到不含 index.html 的目录。
 */
export function resolveSiteRoot(): string {
	return existsSync("dist/client") ? "dist/client" : "dist";
}
