import packageJson from "../package.json" with { type: "json" }
import { encodeStartupPullRequestRequest, parsePullRequestFlag } from "./pullRequestTarget.js"

const help = `ghui ${packageJson.version}

Terminal UI for GitHub pull requests.

Usage:
  ghui              Start the TUI
  ghui --pr [target]
                    Open one pull request. The target is a GitHub pull
                    request URL or owner/repo#number. Without a target,
                    open the pull request for the current branch
  ghui -v, --version
                    Print the installed version
  ghui -h, --help   Show this help message
`

const pullRequestFlag = parsePullRequestFlag(Bun.argv.slice(2))

if (pullRequestFlag._tag === "Invalid") {
	console.error(`Invalid pull request target: ${pullRequestFlag.value || "(empty)"}`)
	console.error("Usage: ghui --pr [https://github.com/<owner>/<repo>/pull/<number> | <owner>/<repo>#<number>]")
	process.exit(1)
}

const args = pullRequestFlag._tag === "Requested" ? pullRequestFlag.rest : Bun.argv.slice(2)
const command = args[0]
const commands = ["help", "version"]

const editDistance = (a: string, b: string) => {
	const distances = Array.from({ length: a.length + 1 }, (_, i) => [i])
	for (let j = 1; j <= b.length; j++) distances[0]![j] = j

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			distances[i]![j] = Math.min(distances[i - 1]![j]! + 1, distances[i]![j - 1]! + 1, distances[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
		}
	}

	return distances[a.length]![b.length]!
}

if (command === "-h" || command === "--help" || command === "help") {
	console.log(help)
	process.exit(0)
}

if (command === "-v" || command === "--version" || command === "version") {
	console.log(packageJson.version)
	process.exit(0)
}

if (command === "upgrade") {
	console.error("Use your package manager to upgrade ghui, for example `brew upgrade ghui`.")
	process.exit(1)
}

if (typeof command === "string") {
	const unknownCommand = command
	const suggestion = commands.find((name) => editDistance(unknownCommand, name) <= 2)
	console.error(`Unknown command: ${unknownCommand}`)
	if (suggestion) console.error(`Did you mean: ghui ${suggestion}?`)
	console.error("Run `ghui --help` for usage.")
	process.exit(1)
}

if (pullRequestFlag._tag === "Requested") process.env.GHUI_PR = encodeStartupPullRequestRequest(pullRequestFlag.request)

await import("./index.js")
