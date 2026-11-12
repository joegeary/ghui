import { describe, expect, test } from "bun:test"

const runStandalone = async (args: readonly string[]) => {
	const child = Bun.spawn(["bun", "src/standalone.ts", ...args], {
		cwd: new URL("..", import.meta.url).pathname,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	})
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
	return { stdout, stderr, exitCode }
}

describe("ghui --pr argument validation", () => {
	test.each([
		[["--pr", "not-a-target"], "not-a-target"],
		[["--pr=kitlangton/ghui"], "kitlangton/ghui"],
		[["--pr="], "(empty)"],
	])("%p exits 1 with a usage error before the TUI starts", async (args, reported) => {
		const result = await runStandalone(args)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain(`Invalid pull request target: ${reported}`)
		expect(result.stderr).toContain("Usage: ghui --pr")
		expect(result.stdout).toBe("")
	})

	test("a valid target still lets a following command run", async () => {
		const result = await runStandalone(["--pr", "kitlangton/ghui#68", "--help"])
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("ghui --pr [target]")
	})

	test("an argument after a valid target is still rejected as an unknown command", async () => {
		const result = await runStandalone(["--pr", "kitlangton/ghui#68", "bogus"])
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain("Unknown command: bogus")
	})
})
