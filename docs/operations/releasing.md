# Releasing

How a maintainer ships a new version (for example `0.3.0`). Versions follow [Semantic Versioning](https://semver.org/); every release has a section in [CHANGELOG.md](../../CHANGELOG.md).

## 1. Prepare the release pull request

1. Set the new version in the root `package.json`, every workspace `package.json` and the default image tag in `compose.yaml` (`CLOUDARCHITECT_VERSION:-…`). `node tools/check-versions.ts` fails if they disagree; CI runs it.
2. Point the install links at the new tag: `README.md`, `docs/operations/installation.md` (install and upgrade commands).
3. Add the CHANGELOG section with the release date and the compare link at the bottom.
4. Regenerate screenshots if the UI changed: `pnpm screenshots`.
5. Run `pnpm run ci` locally, open the pull request and merge it once all checks are green.

## 2. Tag and publish

```bash
git checkout main && git pull
git tag v0.3.0 && git push origin v0.3.0
```

The tag starts **Release images** (`.github/workflows/release.yml`): it builds the `web` and `gateway` images for amd64 and arm64, publishes them to GHCR as `ghcr.io/aliaksandr-liapin/cloudarchitect-lite/{web,gateway}:<version>`, then installs from the published images and checks that neither contains AWS icon files. Its `e2e` jobs (**Browser end-to-end**, one per setup) then run the browser test from `e2e/` against the published images of that version, with recorded AI responses instead of paid calls.

To re-run only the browser test against images that are already published: Actions → Release images → Run workflow, with **version** set (for example `0.4.0`). Nothing is built or published on such a run. It uses the test code of the chosen branch, so it only makes sense for versions that include the gateway's key check against the fake AI server (0.3.2 / 0.4 or later); the 0.3.0 images fail the typed-key steps. The release `e2e` jobs therefore run for the first time at the next tag.

The README install command points at the tag, so it works as soon as the tag is pushed.

## 3. Release notes and demo

Publish the GitHub release for the tag with that version's CHANGELOG section as the notes (links as full URLs). Publishing the release also redeploys the [demo](https://aliaksandr-liapin.github.io/cloudarchitect-lite/) (`pages.yml`); the `github-pages` environment allows `main` and `v*` tags. To redeploy by hand: Actions → Pages → Run workflow.

## 4. Check it like a user

From an empty folder, signed out of GHCR (`docker logout ghcr.io`), run the README install command and finish the setup wizard. Then open the demo and check the new version's changes.

## Security checks

- CI runs gitleaks on every pull request, every push to `main` and weekly. Before a release that changes workflows or adds files from outside the codebase, also scan the whole history:

  ```bash
  docker run --rm -v "$PWD:/repo:ro" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --log-opts="--all" --redact --no-banner
  ```

- Workflows from fork pull requests never receive secrets; the paid live eval skips them (`live-eval.yml`).

## Tested platforms

| Platform               | How                                                          |
| ---------------------- | ------------------------------------------------------------ |
| Linux (amd64)          | CI: install smoke test on every release                      |
| macOS (Apple silicon)  | By hand, Docker Desktop or Rancher Desktop                   |
| Windows (Intel or Arm) | Expected to work through Docker Desktop; not hand-tested yet |
