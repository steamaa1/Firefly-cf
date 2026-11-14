/**
 * 执行 d1-import，并为其提供 Vite 风格的 `?raw` 导入支持。
 *
 * 背景：导入内容必须复用站点的完整 markdown 管线，而管线中的
 * rehype-diagram-panzoom / rehype-plantuml 用了 `import x from "./a.js?raw"`，
 * 这是 Vite 特性，纯 Node 不支持。
 *
 * 这里用 Node 的 module customization hook 注册一个解析器：
 * 命中 `?raw` 的请求就读文件内容，包装成 `export default "<内容>"` 返回。
 * 相比 esbuild 打包，这种方式保留了原来的 ESM 语义，
 * 不会遇到 CJS 动态 require、顶层 await 等打包兼容问题。
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

/** 注册 ?raw 加载钩子（须在导入业务模块之前执行） */
function installRawLoader(): void {
	const hookSource = `
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
	if (specifier.endsWith("?raw")) {
		const clean = specifier.slice(0, -4);
		const url = new URL(clean, context.parentURL);
		return { url: url.href + "?raw", shortCircuit: true };
	}
	return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
	if (url.endsWith("?raw")) {
		const fileUrl = url.slice(0, -4);
		const text = readFileSync(fileURLToPath(fileUrl), "utf8");
		return {
			format: "module",
			source: "export default " + JSON.stringify(text) + ";",
			shortCircuit: true,
		};
	}
	return nextLoad(url, context);
}
`;
	const hookFile = path.join("node_modules", ".cache", "raw-loader-hook.mjs");
	fs.mkdirSync(path.dirname(hookFile), { recursive: true });
	fs.writeFileSync(hookFile, hookSource, "utf8");
	register(pathToFileURL(path.resolve(hookFile)).href);
}

installRawLoader();

// 钩子注册后动态导入，确保其生效
const mod = await import(pathToFileURL(path.resolve("scripts/d1-import.ts")).href);
void mod;
