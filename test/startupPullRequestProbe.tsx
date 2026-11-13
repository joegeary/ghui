import { RegistryContext } from "@effect/atom-react"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { act } from "react"

export interface StartupProbeStep {
	readonly press?: "escape" | "return" | (string & {})
	readonly until: string
}

export interface StartupProbeSnapshot {
	readonly reached: boolean
	readonly frame: string
	readonly selectedUrl: string | null
}

// The app binds its runtime and startup request when its modules load, so the
// caller sets GHUI_PR and the mock environment on the probe process.
export const probeStartupPullRequest = async (steps: readonly StartupProbeStep[]): Promise<readonly StartupProbeSnapshot[]> => {
	// @ts-expect-error -- React's act environment flag is intentionally global.
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	const { App } = await import("../src/App.tsx")
	const { selectedPullRequestAtom } = await import("../src/ui/pullRequests/atoms.ts")
	const registry = AtomRegistry.make()
	const setup = await createTestRenderer({ width: 140, height: 40 })
	const root = createRoot(setup.renderer)
	const snapshots: StartupProbeSnapshot[] = []
	try {
		act(() =>
			root.render(
				<RegistryContext.Provider value={registry}>
					<App />
				</RegistryContext.Provider>,
			),
		)
		for (const step of steps) {
			const press = step.press
			if (press === "escape") act(() => setup.mockInput.pressEscape())
			else if (press === "return") act(() => setup.mockInput.pressEnter())
			else if (press !== undefined) act(() => setup.mockInput.pressKey(press))
			let reached = false
			for (let attempt = 0; attempt < 400 && !reached; attempt++) {
				await act(async () => {
					await setup.renderOnce()
					await new Promise<void>((resolve) => setTimeout(resolve, 1))
				})
				reached = setup.captureCharFrame().includes(step.until)
			}
			snapshots.push({ reached, frame: setup.captureCharFrame(), selectedUrl: registry.get(selectedPullRequestAtom)?.url ?? null })
		}
		return snapshots
	} finally {
		act(() => root.unmount())
		registry.dispose()
		setup.renderer.destroy()
	}
}
