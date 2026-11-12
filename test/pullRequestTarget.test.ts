import { describe, expect, test } from "bun:test"
import { encodeStartupPullRequestRequest, parsePullRequestFlag, parsePullRequestTarget, parseStartupPullRequestRequest } from "../src/pullRequestTarget.ts"

const target = { repository: "kitlangton/ghui", number: 68 }

describe("parsePullRequestTarget", () => {
	test.each([
		"https://github.com/kitlangton/ghui/pull/68",
		"http://www.github.com/kitlangton/ghui/pull/68",
		"github.com/kitlangton/ghui/pull/68",
		"https://github.com/kitlangton/ghui/pull/68/files",
		"https://github.com/kitlangton/ghui/pull/68/commits/abc123",
		"https://github.com/kitlangton/ghui/pull/68#issuecomment-1",
		"https://github.com/kitlangton/ghui/pull/68?diff=split",
		"kitlangton/ghui#68",
		"kitlangton/ghui/pull/68",
		"  kitlangton/ghui#68  ",
	])("accepts %s", (input) => {
		expect(parsePullRequestTarget(input)).toEqual(target)
	})

	test("keeps the repository spelling the caller typed", () => {
		expect(parsePullRequestTarget("Effect-TS/effect.website#7")).toEqual({ repository: "Effect-TS/effect.website", number: 7 })
	})

	test.each([
		"",
		"not-a-target",
		"kitlangton/ghui",
		"kitlangton/ghui#",
		"kitlangton/ghui#0",
		"kitlangton/ghui#abc",
		"kitlangton/ghui#68abc",
		"kitlangton#68",
		"kit langton/ghui#68",
		"kit$/ghui#68",
		"https://github.com/kitlangton/ghui/issues/68",
		"https://github.com/kitlangton/ghui/pull/",
		"https://gitlab.com/kitlangton/ghui/pull/68",
		"68",
	])("rejects %p", (input) => {
		expect(parsePullRequestTarget(input)).toBeNull()
	})
})

describe("parseStartupPullRequestRequest", () => {
	test("reads an explicit target", () => {
		expect(parseStartupPullRequestRequest("kitlangton/ghui#68")).toEqual({ _tag: "Explicit", target })
	})

	test("reads the current-branch request", () => {
		expect(parseStartupPullRequestRequest("current")).toEqual({ _tag: "CurrentBranch" })
	})

	test.each([undefined, "", "   ", "garbage"])("yields no request for %p", (value) => {
		expect(parseStartupPullRequestRequest(value)).toBeNull()
	})

	test("round-trips every request the CLI can encode", () => {
		for (const request of [{ _tag: "Explicit", target }, { _tag: "CurrentBranch" }] as const) {
			expect(parseStartupPullRequestRequest(encodeStartupPullRequestRequest(request))).toEqual(request)
		}
	})
})

describe("parsePullRequestFlag", () => {
	test("is absent when the first argument is not --pr", () => {
		expect(parsePullRequestFlag([])).toEqual({ _tag: "Absent" })
		expect(parsePullRequestFlag(["--help"])).toEqual({ _tag: "Absent" })
		expect(parsePullRequestFlag(["--project"])).toEqual({ _tag: "Absent" })
	})

	test("takes the target from the next argument", () => {
		expect(parsePullRequestFlag(["--pr", "https://github.com/kitlangton/ghui/pull/68/files"])).toEqual({ _tag: "Requested", request: { _tag: "Explicit", target }, rest: [] })
	})

	test("takes the target from an inline value", () => {
		expect(parsePullRequestFlag(["--pr=kitlangton/ghui#68", "extra"])).toEqual({ _tag: "Requested", request: { _tag: "Explicit", target }, rest: ["extra"] })
	})

	test("asks for the current branch when no value follows", () => {
		expect(parsePullRequestFlag(["--pr"])).toEqual({ _tag: "Requested", request: { _tag: "CurrentBranch" }, rest: [] })
		expect(parsePullRequestFlag(["--pr", "--help"])).toEqual({ _tag: "Requested", request: { _tag: "CurrentBranch" }, rest: ["--help"] })
	})

	test("reports a malformed target", () => {
		expect(parsePullRequestFlag(["--pr", "not-a-target"])).toEqual({ _tag: "Invalid", value: "not-a-target" })
		expect(parsePullRequestFlag(["--pr="])).toEqual({ _tag: "Invalid", value: "" })
	})
})
