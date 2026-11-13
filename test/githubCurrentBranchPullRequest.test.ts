import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { CommandError, CommandRunner } from "../src/services/CommandRunner.ts"
import { GitHubService } from "../src/services/GitHubService.ts"

type GhOutcome = { readonly stdout: string } | { readonly stderr: string }

const lookUp = (outcome: GhOutcome) => {
	const calls: string[][] = []
	const respond = (command: string, args: readonly string[]) => {
		calls.push([command, ...args])
		return "stdout" in outcome ? Effect.succeed(outcome.stdout) : Effect.fail(new CommandError({ command, args: [...args], detail: outcome.stderr, cause: outcome.stderr }))
	}
	const runner = Layer.succeed(
		CommandRunner,
		CommandRunner.of({
			run: (command, args) => respond(command, args).pipe(Effect.map((stdout) => ({ stdout, stderr: "", exitCode: 0 }))),
			runSchema: <S extends Schema.Top>(schema: S, command: string, args: readonly string[]) =>
				respond(command, args).pipe(Effect.flatMap((stdout) => Schema.decodeUnknownEffect(schema)(JSON.parse(stdout)))) as Effect.Effect<
					S["Type"],
					CommandError,
					S["DecodingServices"]
				>,
		}),
	)
	const result = Effect.runPromise(
		GitHubService.use((github) => github.getCurrentBranchPullRequest()).pipe(Effect.result, Effect.provide(GitHubService.layerNoDeps.pipe(Layer.provide(runner)))),
	)
	return result.then((value) => ({ value, calls }))
}

describe("GitHubService.getCurrentBranchPullRequest", () => {
	test("resolves the branch's pull request from gh in the working directory", async () => {
		const { value, calls } = await lookUp({ stdout: JSON.stringify({ url: "https://github.com/upstream-owner/repo/pull/42" }) })
		expect(value._tag).toBe("Success")
		if (value._tag === "Success") expect(value.success).toEqual({ _tag: "Found", target: { repository: "upstream-owner/repo", number: 42 } })
		expect(calls.filter((call) => call[1] === "pr")).toEqual([["gh", "pr", "view", "--json", "url"]])
	})

	test("reports the branch name when the branch has no pull request", async () => {
		const { value } = await lookUp({ stderr: 'no pull requests found for branch "feat/pr-flag"' })
		expect(value._tag).toBe("Success")
		if (value._tag === "Success") expect(value.success).toEqual({ _tag: "NotFound", branch: "feat/pr-flag" })
	})

	test.each(["fatal: not a git repository (or any of the parent directories): .git", "could not determine current branch: failed to run git", "HTTP 401: Bad credentials"])(
		"keeps %p as a failure",
		async (stderr) => {
			const { value } = await lookUp({ stderr })
			expect(value._tag).toBe("Failure")
			if (value._tag === "Failure") expect(value.failure).toMatchObject({ _tag: "CommandError", detail: stderr })
		},
	)

	test("fails on a URL that is not a pull request", async () => {
		const { value } = await lookUp({ stdout: JSON.stringify({ url: "https://example.com/nope" }) })
		expect(value._tag).toBe("Failure")
	})
})
