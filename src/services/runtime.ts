import { Layer } from "effect"
import * as Atom from "effect/unstable/reactivity/Atom"
import { config } from "../config.js"
import { detectCurrentGitHubRepository } from "../gitRemotes.js"
import { parsePullRequestTarget, parseStartupPullRequestRequest } from "../pullRequestTarget.js"
import { Observability } from "../observability.js"
import { BrowserOpener } from "./BrowserOpener.js"
import { CacheService } from "./CacheService.js"
import { Clipboard } from "./Clipboard.js"
import { EditorOpener } from "./EditorOpener.js"
import { CommandRunner } from "./CommandRunner.js"
import { GitHubService } from "./GitHubService.js"

const parseOptionalPositiveInt = (value: string | undefined, fallback: number | null) => {
	if (value === undefined) return fallback
	const parsed = Number.parseInt(value, 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const mockPrCount = parseOptionalPositiveInt(process.env.GHUI_MOCK_PR_COUNT, null)
export const mockRepository = process.env.GHUI_MOCK_REPOSITORY?.trim() || null
export const detectedRepository = mockPrCount === null ? detectCurrentGitHubRepository() : mockRepository
export const startupPullRequestRequest = parseStartupPullRequestRequest(process.env.GHUI_PR)
// Read once. Left set, every process ghui spawns (editor, shells) would inherit
// it and a ghui started there would reopen this pull request.
delete process.env.GHUI_PR
// The repository the app opens scoped to, so the list behind a startup pull
// request is already the right one when its detail view closes.
export const startupRepository =
	startupPullRequestRequest === null ? null : startupPullRequestRequest._tag === "Explicit" ? startupPullRequestRequest.target.repository : detectedRepository
export const mockUsername = process.env.GHUI_MOCK_USERNAME?.trim() || (mockPrCount !== null ? "kitlangton" : undefined)

export const mockWorkspacePreferencesPath = (() => {
	if (mockPrCount === null) return null
	const value = process.env.GHUI_MOCK_WORKSPACE_PREFERENCES_PATH?.trim()
	if (value === "off" || value === "0" || value === "false") return null
	return value && value.length > 0 ? value : ".ghui/mock-workspace-preferences.json"
})()

export const mockRepositoryCatalog =
	mockPrCount === null || !mockRepository
		? []
		: [
				{ repository: mockRepository ?? "anomalyco/opencode", pullRequestCount: 0, issueCount: 0, description: "OpenCode project workspace" },
				{ repository: "kitlangton/ghui", pullRequestCount: 7, issueCount: 4, description: "Terminal UI for GitHub pull requests" },
				{ repository: "kitlangton/homebrew-tap", pullRequestCount: 0, issueCount: 0, description: "Homebrew formula automation" },
				{ repository: "Effect-TS/effect", pullRequestCount: 31, issueCount: 9, description: "Effect TypeScript runtime and libraries" },
			]

const defaultRecentRepositories = mockRepositoryCatalog.length > 0 ? mockRepositoryCatalog.map((repo) => repo.repository) : detectedRepository ? [detectedRepository] : []
export const initialRecentRepositories = startupRepository
	? [startupRepository, ...defaultRecentRepositories.filter((repository) => repository !== startupRepository)]
	: defaultRecentRepositories

export const pullRequestPageSize = Math.min(100, parseOptionalPositiveInt(process.env.GHUI_PR_PAGE_SIZE, config.prPageSize) ?? config.prPageSize)

const githubServiceLayer =
	mockPrCount !== null
		? (await import("./MockGitHubService.js")).MockGitHubService.layer({
				prCount: mockPrCount,
				repoCount: parseOptionalPositiveInt(process.env.GHUI_MOCK_REPO_COUNT, 4) ?? 4,
				repository: mockRepository,
				repositories: mockRepositoryCatalog.map((repo) => repo.repository),
				currentBranchPullRequest: parsePullRequestTarget(process.env.GHUI_MOCK_CURRENT_BRANCH_PR ?? ""),
				...(mockUsername ? { username: mockUsername } : {}),
			})
		: GitHubService.layerNoDeps

const cacheServiceLayer = mockPrCount !== null ? CacheService.disabledLayer : CacheService.layerFromPath(config.cachePath)

const editorOpenerLayer = mockPrCount !== null ? EditorOpener.mockLayer : EditorOpener.layerNoDeps

export const githubRuntime = Atom.runtime(
	Layer.mergeAll(githubServiceLayer, cacheServiceLayer, Clipboard.layerNoDeps, BrowserOpener.layerNoDeps, editorOpenerLayer).pipe(
		Layer.provide(CommandRunner.layer),
		Layer.provideMerge(Observability.layer),
	),
)
