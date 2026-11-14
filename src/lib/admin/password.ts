/**
 * 管理员密码哈希（PBKDF2-SHA256）。
 *
 * 只用 Web Crypto，不引入 bcrypt/argon2 等原生依赖：
 * 这些库在 workerd 中需要 WASM 或 native 编译，会显著增大 bundle 且不一定可用。
 * PBKDF2 迭代 10 万次在 Workers 免费版 CPU 预算内，对单人后台足够。
 */

const ITERATIONS = 100_000;
const KEY_LEN = 32;

function toHex(buf: ArrayBuffer): string {
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

/** 生成 "pbkdf2$<iterations>$<saltHex>$<hashHex>" 格式的字符串 */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
		key,
		KEY_LEN * 8,
	);
	return `pbkdf2$${ITERATIONS}$${toHex(salt.buffer as ArrayBuffer)}$${toHex(bits)}`;
}

/** 常量时间比较，避免时序侧信道 */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

	const iterations = Number.parseInt(parts[1], 10);
	const salt = fromHex(parts[2]);
	const expected = parts[3];

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
		key,
		KEY_LEN * 8,
	);
	return timingSafeEqual(toHex(bits), expected);
}
