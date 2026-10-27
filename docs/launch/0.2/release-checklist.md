# 0.2.0 release checklist

For the product owner. Every step here is an account-level action. Do them in order.

## Before going public

| Check                                                                                         | Result                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------- |
| Secret scan of full history (gitleaks, all refs, plus a filename check for key and env files) | pending — to be filled by the scan |
| Fork safety of workflows                                                                      | done, see below                    |

### Fork safety

GitHub does not pass repository secrets to workflows triggered by `pull_request` from a fork. Checked in `.github/workflows/`:

- Only `live-eval.yml` reads a custom secret (`ANTHROPIC_API_KEY`). `release.yml` uses `GITHUB_TOKEN` only, and it runs on tag push, not on pull requests. `ci.yml`, `security.yml` and `pages.yml` read no secrets.
- No workflow uses `pull_request_target`.
- Before this change, a fork PR that was not a draft started the `live-eval` job; the secret was empty and `eval/src/live.ts` printed "ANTHROPIC_API_KEY not set — live eval skipped" and exited 0. It skipped, did not fail, but the job still ran fork code on a runner.
- Now the job has an explicit guard: `github.event.pull_request.head.repo.full_name == github.repository`, so a fork PR skips the whole job. Manual dispatch is unchanged (only people with write access can start it).
- `security.yml` runs the dependency-review job only when the repository variable `GHAS_ENABLED` is `true`; it needs no secret.

## Release steps (in order)

1. Set the date of 0.2.0 in `CHANGELOG.md` (now `2026-11-xx`) before tagging, and commit it on the release branch.
2. Merge the 0.2 pull request into `main` (CI must be green).
3. Push the tag from the merged `main`:
   ```bash
   git checkout main && git pull
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```
4. Wait for the Release images workflow and its published-image smoke job to finish green.
5. Make the repository public: Settings, General, Danger Zone, Change visibility.
6. Make both GHCR packages public (Packages, package settings, Change visibility):
   - `ghcr.io/aliaksandr-liapin/cloudarchitect-lite/web`
   - `ghcr.io/aliaksandr-liapin/cloudarchitect-lite/gateway`

   Then check an anonymous pull works: `docker logout ghcr.io && docker pull ghcr.io/aliaksandr-liapin/cloudarchitect-lite/web:0.2.0` (and the same for `gateway`). Use the tag format the Release images workflow publishes.

7. Enable Pages: Settings, Pages, Source: GitHub Actions. Run `pages.yml` (Actions, Pages, Run workflow). Check <https://aliaksandr-liapin.github.io/cloudarchitect-lite/>. Publishing the GitHub release in step 12 also triggers this workflow.
8. Set the description and topics:
   ```bash
   gh repo edit aliaksandr-liapin/cloudarchitect-lite \
     --description "Describe your app, get an AWS architecture checked against 25 rules, on your own key. Self-hosted." \
     --homepage "https://aliaksandr-liapin.github.io/cloudarchitect-lite/" \
     --add-topic aws --add-topic architecture --add-topic diagram --add-topic llm \
     --add-topic claude --add-topic react-flow --add-topic self-hosted
   ```
9. Upload `docs/images/social-preview.png` in Settings, General, Social preview.
10. Hand-test the install on Windows 11 ARM (Parallels) with the PowerShell command from the README.
11. Fill the tested-platforms table below.
12. Publish the GitHub release for `v0.2.0` with the 0.2.0 section of `CHANGELOG.md` as the notes.
13. Before posting, confirm `docs/images/demo.gif` is in the repository and shows in the README.
14. Post the drafts (`linkedin.md`, `devto.md`) after editing them.

## Tested platforms

| Platform            | How                                          | Status                            |
| ------------------- | -------------------------------------------- | --------------------------------- |
| macOS Apple Silicon | Built and run locally with Rancher Desktop   | tested by the builder             |
| Linux               | CI (install smoke and published-image smoke) | tested in CI                      |
| Windows 11 ARM      | Parallels, PowerShell install                | to be hand-tested by the owner    |
| Windows x64         | Same multi-arch images                       | expected to work, not hand-tested |
