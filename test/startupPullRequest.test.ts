import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runIsolatedProbe } from "./isolatedProbe.ts"
import type { StartupProbeSnapshot, StartupProbeStep } from "./startupPullRequestProbe.tsx"

// Every app-side variable is pinned, because probes inherit whatever the
// render suites in this process exported. Each mock repository holds 20 pull
// requests and a page holds 5, so #1077 and #1079 sit on the last page.
const mockEnv = {
	GHUI_MOCK_PR_COUNT: "80",
	GHUI_MOCK_REPO_COUNT: "4",
	GHUI_MOCK_REPOSITORY: "",
	GHUI_MOCK_CURRENT_BRANCH_PR: "",
	GHUI_MOCK_FIXTURE_PATH: join(tmpdir(), "ghui-test-no-fixture.json"),
	GHUI_MOCK_WORKSPACE_PREFERENCES_PATH: "off",
	GHUI_PR_PAGE_SIZE: "5",
	GHUI_PR: "",
}

const launch = async (env: Partial<typeof mockEnv>, steps: readonly StartupProbeStep[]): Promise<readonly StartupProbeSnapshot[]> => {
	const stdout = await runIsolatedProbe(
		`
			import { probeStartupPullRequest } from "./test/startupPullRequestProbe.tsx"
			console.log(JSON.stringify(await probeStartupPullRequest(${JSON.stringify(steps)})))
			process.exit(0)
		`,
		{ ...mockEnv, ...env },
	)
	return JSON.parse(stdout)
}

const expectReached = (snapshots: readonly StartupProbeSnapshot[]) => {
	for (const snapshot of snapshots) expect(snapshot.reached, snapshot.frame).toBe(true)
}

const detailFooter = "esc back"
const listTabs = "PULL REQUESTS"

describe("startup seeding from GHUI_PR", () => {
	const seeded = async (env: Partial<typeof mockEnv>) =>
		JSON.parse(
			await runIsolatedProbe(
				`
					import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
					import { activeIssueViewAtom } from "./src/ui/issues/atoms.ts"
					import { activeViewAtom } from "./src/ui/pullRequests/atoms.ts"
					import { recentRepositoriesAtom, workspaceScopeAtom } from "./src/workspace/atoms.ts"
					const registry = AtomRegistry.make()
					console.log(JSON.stringify({
						view: registry.get(activeViewAtom),
						issueView: registry.get(activeIssueViewAtom),
						scope: registry.get(workspaceScopeAtom),
						recents: registry.get(recentRepositoriesAtom),
					}))
				`,
				{ ...mockEnv, ...env },
			),
		)

	test("an explicit target scopes the app to its repository", async () => {
		expect(await seeded({ GHUI_PR: "owner/repo#7" })).toEqual({
			view: { _tag: "Repository", repository: "owner/repo" },
			issueView: { _tag: "Repository", repository: "owner/repo" },
			scope: { _tag: "Repository", repository: "owner/repo" },
			recents: ["owner/repo"],
		})
	})

	test("an explicit target leads the recent repositories without duplicating one", async () => {
		const state = await seeded({ GHUI_PR: "kitlangton/ghui#7", GHUI_MOCK_REPOSITORY: "acme/widgets" })
		expect(state.scope).toEqual({ _tag: "Repository", repository: "kitlangton/ghui" })
		expect(state.recents).toEqual(["kitlangton/ghui", "acme/widgets", "kitlangton/homebrew-tap", "Effect-TS/effect"])
	})

	test("a current-branch request scopes the app to the detected repository", async () => {
		const state = await seeded({ GHUI_PR: "current", GHUI_MOCK_REPOSITORY: "acme/widgets" })
		expect(state.view).toEqual({ _tag: "Repository", repository: "acme/widgets" })
		expect(state.issueView).toEqual({ _tag: "Repository", repository: "acme/widgets" })
		expect(state.scope).toEqual({ _tag: "Repository", repository: "acme/widgets" })
	})

	test("a current-branch request outside a repository keeps the user scope", async () => {
		const state = await seeded({ GHUI_PR: "current" })
		expect(state.view).toEqual({ _tag: "Queue", mode: "authored", repository: null })
		expect(state.scope).toEqual({ _tag: "User" })
	})

	test("no request keeps the user scope", async () => {
		const state = await seeded({ GHUI_MOCK_REPOSITORY: "acme/widgets" })
		expect(state.view).toEqual({ _tag: "Queue", mode: "authored", repository: null })
		expect(state.scope).toEqual({ _tag: "User" })
	})
})

describe("pinned pull request in the displayed list", () => {
	const displayed = async (body: string) =>
		JSON.parse(
			await runIsolatedProbe(
				`
					import { Effect } from "effect"
					import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
					import { viewCacheKey } from "./src/pullRequestViews.ts"
					import {
						activeViewAtom,
						displayedPullRequestsAtom,
						pinnedPullRequestAtom,
						pullRequestDetailsForRevision,
						pullRequestOverridesAtom,
						pullRequestRevisionAtomKey,
						queueLoadCacheAtom,
						recentlyCompletedPullRequestsAtom,
					} from "./src/ui/pullRequests/atoms.ts"
					const registry = AtomRegistry.make()
					const view = { _tag: "Repository", repository: "mock-org/repo-1" }
					const item = (number, fields = {}) => ({
						repository: "mock-org/repo-1",
						number,
						url: "https://github.com/mock-org/repo-1/pull/" + number,
						headRefOid: "head-" + number,
						state: "open",
						body: "",
						detailLoaded: false,
						updatedAt: new Date(2026, 0, number),
						...fields,
					})
					const pinned = item(3, { body: "pinned body", detailLoaded: true })
					const setLoad = (data) => registry.set(queueLoadCacheAtom, { [viewCacheKey(view)]: { view, data, fetchedAt: new Date(), endCursor: null, hasNextPage: false } })
					const rows = () => registry.get(displayedPullRequestsAtom).map((row) => ({ number: row.number, state: row.state, body: row.body, detailLoaded: row.detailLoaded, title: row.title }))
					registry.set(activeViewAtom, view)
					setLoad([item(5), item(4)])
					registry.set(pinnedPullRequestAtom, pinned)
					${body}
				`,
				mockEnv,
			),
		)

	test("joins the list in update order when the loaded page does not contain it", async () => {
		expect((await displayed(`console.log(JSON.stringify(rows()))`)).map((row: { number: number }) => row.number)).toEqual([5, 4, 3])
	})

	test("is not duplicated once the list contains it, and lends its detail to the summary row", async () => {
		const rows = await displayed(`
			setLoad([item(5), item(3)])
			console.log(JSON.stringify(rows()))
		`)
		expect(rows).toEqual([
			{ number: 5, state: "open", body: "", detailLoaded: false },
			{ number: 3, state: "open", body: "pinned body", detailLoaded: true },
		])
	})

	test("does not lend detail to a row whose head has moved", async () => {
		const rows = await displayed(`
			setLoad([item(3, { headRefOid: "newer-head" })])
			console.log(JSON.stringify(rows()))
		`)
		expect(rows).toEqual([{ number: 3, state: "open", body: "", detailLoaded: false }])
	})

	test("shows optimistic edits and completion for the pinned row", async () => {
		const rows = await displayed(`
			registry.set(pullRequestOverridesAtom, { [pinned.url]: { ...pinned, body: "edited" } })
			const edited = rows()
			registry.set(recentlyCompletedPullRequestsAtom, { [pinned.url]: { ...pinned, state: "merged" } })
			console.log(JSON.stringify({ edited, completed: rows() }))
		`)
		expect(rows.edited.find((row: { number: number }) => row.number === 3)).toMatchObject({ body: "edited" })
		expect(rows.completed.filter((row: { number: number }) => row.number === 3)).toEqual([{ number: 3, state: "merged", body: "pinned body", detailLoaded: true }])
	})

	test("is hidden from a view scoped to another repository", async () => {
		const rows = await displayed(`
			registry.set(activeViewAtom, { _tag: "Repository", repository: "mock-org/repo-2" })
			console.log(JSON.stringify(rows()))
		`)
		expect(rows).toEqual([])
	})

	test("a detail refresh replaces the pinned snapshot even after its head moved", async () => {
		const rows = await displayed(`
			const stale = item(1077, { headRefOid: "stale-head", title: "stale title", detailLoaded: true })
			registry.set(pinnedPullRequestAtom, stale)
			await Effect.runPromise(AtomRegistry.getResult(registry, pullRequestDetailsForRevision(pullRequestRevisionAtomKey(stale)), { suspendOnWaiting: true }))
			console.log(JSON.stringify(rows()))
		`)
		expect(rows.find((row: { number: number }) => row.number === 1077)).toMatchObject({ title: "chore(husky): add bun to PATH in pre-push hook", detailLoaded: true })
	})
})

describe("launching with a pull request target", () => {
	const target = "https://github.com/mock-org/repo-1/pull/1077"

	test("opens the detail view of a pull request beyond the first list page", async () => {
		const snapshots = await launch({ GHUI_PR: "mock-org/repo-1#1077" }, [{ until: "3 comments" }])
		expectReached(snapshots)
		const [detail] = snapshots
		expect(detail!.frame).toContain("HOME / mock-org/repo-1")
		expect(detail!.frame).toContain("chore(husky): add bun to PATH in pre-push hook")
		expect(detail!.frame).toContain("#1077 by tess")
		expect(detail!.frame).toContain(detailFooter)
		expect(detail!.frame).not.toContain(listTabs)
		expect(detail!.selectedUrl).toBe(target)
	})

	test("escape lands on the repository list with the target pinned and selected", async () => {
		const snapshots = await launch({ GHUI_PR: "mock-org/repo-1#1077" }, [{ until: detailFooter }, { press: "escape", until: "5 loaded" }])
		expectReached(snapshots)
		const list = snapshots[1]!
		expect(list.frame).toContain("HOME / mock-org/repo-1")
		expect(list.frame).toContain(listTabs)
		expect(list.frame).toContain("#1001 fix(provider): constrain OpenAI deep research efforts")
		expect(list.frame).toContain("#1077 chore(husky): add bun to PATH in pre-push hook")
		expect(list.frame.match(/#1077 chore\(husky\)/g)).toHaveLength(1)
		expect(list.selectedUrl).toBe(target)
	})

	test("diff and comments open from the startup detail view", async () => {
		const snapshots = await launch({ GHUI_PR: "mock-org/repo-1#1077" }, [
			{ until: detailFooter },
			{ press: "d", until: "src/mockDiff.ts" },
			{ press: "escape", until: "5 loaded" },
			{ press: "c", until: "Top-level discussion for #1077" },
		])
		expectReached(snapshots)
		expect(snapshots.map((snapshot) => snapshot.selectedUrl)).toEqual([target, target, target, target])
	})

	test("leaving the repository drops the pinned pull request", async () => {
		const snapshots = await launch({ GHUI_PR: "mock-org/repo-1#1077" }, [
			{ until: detailFooter },
			{ press: "escape", until: "5 loaded" },
			{ press: "escape", until: "REPOS" },
			{ press: "2", until: "#1000 fix(provider): align Anthropic Opus 4.5 efforts" },
		])
		expectReached(snapshots)
		expect(snapshots[1]!.frame).toContain("#1077")
		expect(snapshots[3]!.frame).not.toContain("#1077")
	})

	test("a repository name typed in another case lands on the canonical repository", async () => {
		const snapshots = await launch({ GHUI_PR: "Mock-Org/Repo-1#1077" }, [{ until: detailFooter }, { press: "escape", until: "5 loaded" }])
		expectReached(snapshots)
		expect(snapshots[0]!.frame).toContain("#1077 by tess")
		const list = snapshots[1]!
		expect(list.frame).toContain("HOME / mock-org/repo-1")
		expect(list.frame).toContain("#1001 fix(provider): constrain OpenAI deep research efforts")
		expect(list.selectedUrl).toBe(target)
	})

	test("a target that cannot be fetched reports the error and stays on the repository list", async () => {
		const snapshots = await launch({ GHUI_PR: "mock-org/repo-1#9999" }, [{ until: "Pull request not found: mock-org/repo-1#9999" }])
		expectReached(snapshots)
		const [list] = snapshots
		expect(list!.frame).toContain("HOME / mock-org/repo-1")
		expect(list!.frame).toContain(listTabs)
		expect(list!.frame).toContain("#1001 fix(provider): constrain OpenAI deep research efforts")
		expect(list!.frame).not.toContain(detailFooter)
	})
})

describe("launching for the current branch", () => {
	test("opens the branch's pull request, moving to the repository that owns it", async () => {
		const snapshots = await launch({ GHUI_PR: "current", GHUI_MOCK_REPOSITORY: "acme/widgets", GHUI_MOCK_CURRENT_BRANCH_PR: "Effect-TS/effect#1079" }, [
			{ until: detailFooter },
			{ press: "escape", until: "5 loaded" },
		])
		expectReached(snapshots)
		expect(snapshots[0]!.frame).toContain("#1079 by kai")
		const list = snapshots[1]!
		expect(list.frame).toContain("HOME / Effect-TS/effect")
		expect(list.frame).toContain("#1003 fix(provider): align GPT-5 reasoning variants")
		expect(list.selectedUrl).toBe("https://github.com/Effect-TS/effect/pull/1079")
	})

	test("a branch without a pull request shows the detected repository's list and a notice", async () => {
		const snapshots = await launch({ GHUI_PR: "current", GHUI_MOCK_REPOSITORY: "acme/widgets" }, [{ until: "No pull request for branch mock-branch" }])
		expectReached(snapshots)
		const [list] = snapshots
		expect(list!.frame).toContain("HOME / acme/widgets")
		expect(list!.frame).toContain(listTabs)
		expect(list!.frame).toContain("#1000 fix(provider): align Anthropic Opus 4.5 efforts")
		expect(list!.frame).not.toContain(detailFooter)
	})

	test("outside a repository the notice shows over the normal startup view", async () => {
		const snapshots = await launch({ GHUI_PR: "current" }, [{ until: "No pull request for branch mock-branch" }])
		expectReached(snapshots)
		expect(snapshots[0]!.frame).toContain("REPOS")
		expect(snapshots[0]!.frame).not.toContain(detailFooter)
	})
})
