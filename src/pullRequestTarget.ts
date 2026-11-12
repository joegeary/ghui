import { parseRepositoryInput } from "./pullRequestViews.js"

export interface PullRequestTarget {
	readonly repository: string
	readonly number: number
}

export type StartupPullRequestRequest = { readonly _tag: "Explicit"; readonly target: PullRequestTarget } | { readonly _tag: "CurrentBranch" }

export type CurrentBranchPullRequest = { readonly _tag: "Found"; readonly target: PullRequestTarget } | { readonly _tag: "NotFound"; readonly branch: string }

export type PullRequestFlag =
	| { readonly _tag: "Absent" }
	| { readonly _tag: "Invalid"; readonly value: string }
	| { readonly _tag: "Requested"; readonly request: StartupPullRequestRequest; readonly rest: readonly string[] }

const PULL_PATH_PATTERN = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([^/\s]+\/[^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i
const SHORTHAND_PATTERN = /^([^/\s]+\/[^/\s#]+)#(\d+)$/

export const parsePullRequestTarget = (input: string): PullRequestTarget | null => {
	const trimmed = input.trim()
	const match = trimmed.match(PULL_PATH_PATTERN) ?? trimmed.match(SHORTHAND_PATTERN)
	if (!match) return null
	const repository = parseRepositoryInput(match[1]!)
	const number = Number.parseInt(match[2]!, 10)
	if (!repository || !Number.isSafeInteger(number) || number <= 0) return null
	return { repository, number }
}

export const formatPullRequestTarget = (target: PullRequestTarget) => `${target.repository}#${target.number}`

const CURRENT_BRANCH = "current"

// `GHUI_PR` carries the request from the CLI entry point to the app, so the
// source entry points that skip argv parsing can open a pull request too.
export const encodeStartupPullRequestRequest = (request: StartupPullRequestRequest) => (request._tag === "CurrentBranch" ? CURRENT_BRANCH : formatPullRequestTarget(request.target))

export const parseStartupPullRequestRequest = (value: string | undefined): StartupPullRequestRequest | null => {
	const trimmed = value?.trim()
	if (!trimmed) return null
	if (trimmed === CURRENT_BRANCH) return { _tag: "CurrentBranch" }
	const target = parsePullRequestTarget(trimmed)
	return target ? { _tag: "Explicit", target } : null
}

export const parsePullRequestFlag = (args: readonly string[]): PullRequestFlag => {
	const [flag, value] = args
	if (flag === undefined) return { _tag: "Absent" }
	const inline = flag.startsWith("--pr=") ? flag.slice("--pr=".length) : null
	if (inline === null && flag !== "--pr") return { _tag: "Absent" }
	if (inline === null && (value === undefined || value.startsWith("-"))) return { _tag: "Requested", request: { _tag: "CurrentBranch" }, rest: args.slice(1) }
	const raw = inline ?? value!
	const target = parsePullRequestTarget(raw)
	if (!target) return { _tag: "Invalid", value: raw }
	return { _tag: "Requested", request: { _tag: "Explicit", target }, rest: args.slice(inline === null ? 2 : 1) }
}
