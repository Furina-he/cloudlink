// Synthetic P8c catalog. No real GitHub account, credential or network is consulted.
import type { GithubOwner, GithubRepo, GithubSnapshotStatus } from "@/bindings"

export const githubOwners: GithubOwner[] = [
  { id: "owner:U_octo", login: "octo-dev", kind: "user" },
  { id: "owner:O_labs", login: "octo-labs", kind: "organization" },
]

const parameter = new URLSearchParams(window.location.search).get("github")
export const githubFixture = {
  status: (["partial", "offline", "denied"].includes(parameter ?? "") ? parameter : "complete") as GithubSnapshotStatus,
  extra: parameter === "new",
  renamed: parameter === "renamed",
  transferred: parameter === "transferred",
}

export function githubRepositories(owner: GithubOwner): GithubRepo[] {
  const names = owner.kind === "user" ? ["shop-web", githubFixture.renamed ? "api-renamed" : "api", "notes"] : ["control-plane", "shared-client"]
  const ids = owner.kind === "user" ? ["repo:R_shop", "repo:R_api", "repo:R_notes"] : ["repo:R_control", "repo:R_client"]
  let repos: GithubRepo[] = names.map((name, index) => ({
    id: ids[index], name: `${owner.login}/${name}`, ownerId: owner.id,
    defaultBranch: name === "notes" ? "master" : "main",
    visibility: index === names.length - 1 ? "public" : "private", selected: false,
  }))
  if (githubFixture.transferred) {
    if (owner.kind === "user") repos = repos.filter((repo) => repo.id !== "repo:R_notes")
    else repos.push({ id: "repo:R_notes", name: `${owner.login}/notes`, ownerId: owner.id, defaultBranch: "master", visibility: "public", selected: false })
  }
  if (githubFixture.extra) repos.push({ id: owner.kind === "user" ? "repo:R_future" : "repo:R_labs_future", name: `${owner.login}/future-api`, ownerId: owner.id, defaultBranch: "main", visibility: "private", selected: false })
  return repos
}
