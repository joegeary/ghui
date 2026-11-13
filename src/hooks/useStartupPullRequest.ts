import { useAtomSet } from "@effect/atom-react"
import { useEffect, useRef, useState } from "react"
import type { PullRequestItem } from "../domain.js"
import { errorMessage } from "../errors.js"
import type { StartupPullRequestRequest } from "../pullRequestTarget.js"
import { type PullRequestView, viewEquals } from "../pullRequestViews.js"
import { detailFullViewAtom, detailScrollOffsetAtom } from "../ui/detail/atoms.js"
import { filterDraftAtom, filterModeAtom, filterQueryAtom } from "../ui/filter/atoms.js"
import { pinnedPullRequestAtom, resolveStartupPullRequestAtom } from "../ui/pullRequests/atoms.js"
import { workspaceSurfaceAtom } from "../workspace/atoms.js"

export interface UseStartupPullRequestInput {
	readonly request: StartupPullRequestRequest | null
	readonly activeView: PullRequestView
	readonly visiblePullRequests: readonly PullRequestItem[]
	readonly switchViewTo: (view: PullRequestView) => void
	readonly selectPullRequestByUrl: (url: string) => void
	readonly flashNotice: (message: string) => void
}

/**
 * Opens the pull request named on the command line. The fetched pull request
 * is pinned into its repository's list, selected, and shown in the detail
 * view, so closing the detail lands on that list with it still selected.
 */
export const useStartupPullRequest = (input: UseStartupPullRequestInput): void => {
	const { request, visiblePullRequests, selectPullRequestByUrl } = input
	const resolveStartupPullRequest = useAtomSet(resolveStartupPullRequestAtom, { mode: "promise" })
	const setPinnedPullRequest = useAtomSet(pinnedPullRequestAtom)
	const setActiveWorkspaceSurface = useAtomSet(workspaceSurfaceAtom)
	const setFilterQuery = useAtomSet(filterQueryAtom)
	const setFilterDraft = useAtomSet(filterDraftAtom)
	const setFilterMode = useAtomSet(filterModeAtom)
	const setDetailFullView = useAtomSet(detailFullViewAtom)
	const setDetailScrollOffset = useAtomSet(detailScrollOffsetAtom)
	const [pinnedUrlToOpen, setPinnedUrlToOpen] = useState<string | null>(null)
	const latest = useRef(input)
	latest.current = input

	useEffect(() => {
		if (request === null) return
		let cancelled = false
		const pin = (pullRequest: PullRequestItem) => {
			// The fetched repository name is canonical. A typed name can differ in
			// case, and a fork checkout's branch can belong to an upstream pull
			// request, so the list moves to the repository that owns it.
			const view: PullRequestView = { _tag: "Repository", repository: pullRequest.repository }
			if (!viewEquals(view, latest.current.activeView)) latest.current.switchViewTo(view)
			setFilterQuery("")
			setFilterDraft("")
			setFilterMode(false)
			setActiveWorkspaceSurface("pullRequests")
			setPinnedPullRequest(pullRequest)
			setPinnedUrlToOpen(pullRequest.url)
		}
		void resolveStartupPullRequest(request)
			.then((result) => {
				if (cancelled) return
				if (result._tag === "Found") pin(result.pullRequest)
				else latest.current.flashNotice(`No pull request for branch ${result.branch}`)
			})
			.catch((error) => {
				if (!cancelled) latest.current.flashNotice(errorMessage(error))
			})
		return () => {
			cancelled = true
		}
	}, [request, resolveStartupPullRequest, setActiveWorkspaceSurface, setFilterDraft, setFilterMode, setFilterQuery, setPinnedPullRequest])

	// Selection is an index into the visible list, so the detail view opens one
	// render after the pin joins that list. Opening it sooner would show
	// whichever row the index pointed at before.
	useEffect(() => {
		if (pinnedUrlToOpen === null) return
		setPinnedUrlToOpen(null)
		if (!visiblePullRequests.some((pullRequest) => pullRequest.url === pinnedUrlToOpen)) return
		selectPullRequestByUrl(pinnedUrlToOpen)
		setDetailFullView(true)
		setDetailScrollOffset(0)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pinnedUrlToOpen, visiblePullRequests])
}
