/**
 * 扫描项目里实际引用到的 Iconify 图标，生成 astro-icon 的 include 白名单。
 *
 * 为什么需要：astro-icon 在 SSR 下默认把每个已安装图标集的全部图标
 * 打进 server bundle（实测约 20MB）。显式列白名单可大幅缩减体积。
 * 但图标名大量来自配置与动态变量，手工维护易漏，因此这里自动扫描：
 *   - .astro/.svelte 里的 name="set:icon" 静态写法
 *   - .ts/.js 配置里的 "set:icon" 字符串（含 navBarConfig / profileConfig 等）
 *   - 局部图标 src/icons/**
 *
 * 用法：
 *   npx tsx scripts/gen-icon-include.ts          # 打印 include 配置
 *   npx tsx scripts/gen-icon-include.ts --write  # 写入 src/constants/icon-include.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";

const ICON_RE = /["']?([a-z][a-z0-9]*(?:-[a-z0-9]+)*):([a-z0-9][a-z0-9-]*)["']?/g;

/** 常见的非图标 href/URL 前缀，避免误判 */
const IGNORE_PREFIXES = new Set([
	"http",
	"https",
	"mailto",
	"tel",
	"data",
	"file",
	"ftp",
	"ws",
	"wss",
	"urn",
	"about",
]);

async function main() {
	const files = await glob(["{src,scripts}/{**/*.astro,**/*.svelte,**/*.ts,**/*.js,**/*.mjs}"], {
		nodir: true,
		ignore: ["src/content/**", "**/*.d.ts"],
	});

	const bySet = new Map<string, Set<string>>();
	for (const f of files) {
		let text: string;
		try {
			text = await fs.readFile(f, "utf8");
		} catch {
			continue;
		}
		for (const m of text.matchAll(ICON_RE)) {
			const [full, set, name] = m;
			if (IGNORE_PREFIXES.has(set)) continue;
			// 排除 TypeScript 类型标注等噪声：要求形如 "set:icon" 且 set 长度合理
			if (set.length < 2 || set.length > 32) continue;
			if (!bySet.has(set)) bySet.set(set, new Set());
			bySet.get(set)?.add(name);
			void full;
		}
	}

	// 已知的 iconify 集合（与 package.json 中 @iconify-json/* 对应）
	const knownSets = [
		"material-symbols",
		"fa7-brands",
		"fa7-regular",
		"fa7-solid",
		"simple-icons",
		"mdi",
		"mingcute",
		"svg-spinners",
	];

	const include: Record<string, string[]> = {};
	for (const set of knownSets) {
		const found = bySet.get(set);
		if (found && found.size > 0) {
			include[set] = [...found].sort();
		}
	}

	const total = Object.values(include).reduce((n, a) => n + a.length, 0);
	console.error(`扫描 ${files.length} 个文件，命中 ${total} 个图标：`);
	for (const [set, list] of Object.entries(include)) {
		console.error(`  ${set}: ${list.length}`);
	}

	const json = JSON.stringify(include, null, 2);

	if (process.argv.includes("--write")) {
		await fs.mkdir("src/constants", { recursive: true });
		await fs.writeFile(path.join("src/constants", "icon-include.json"), `${json}\n`, "utf8");
		console.error("✅ 已写入 src/constants/icon-include.json");
	} else {
		console.log(json);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
