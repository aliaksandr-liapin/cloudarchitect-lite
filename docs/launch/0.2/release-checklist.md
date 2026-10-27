# 0.2.0 release checklist

For the product owner. Every step here is an account-level action. Do them in order.

## Before going public

| Check                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret scan of full history | done 2026-10-27: gitleaks v8.30.1 (`ghcr.io/gitleaks/gitleaks:v8.30.1`), `gitleaks git <repo> --log-opts="--all" --redact`, all refs at 41b6b44. 37 commits scanned (all 40 commits in all refs; merge commits carry no diff of their own), 0 findings. File-name check (.zip, .pem, .key, .p12, .pfx, .env*) over all history: only `.env.example`. Re-run the same command right before making the repository public if more commits land. |
| Fork safety of workflows    | done, see below                                                                                                                                                                                                                                                                                                                                                                                                                              |

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
5. Hand-test the install on Windows 11 on Arm (Parallels) while the repository and images are still private, so a failure can be fixed before anyone sees it:
   - Create a personal access token (classic) with only `read:packages` and log in to GHCR in PowerShell: `docker login ghcr.io -u <user>` (paste the token as the password).
   - The raw `compose.yaml` URL only works once the repository is public, so download `compose.yaml` of the `v0.2.0` tag from github.com while signed in (Download raw file) into an empty folder.
   - In that folder run `docker compose up`, as the one-command install in the README does after the download. Open the setup link, finish the wizard, generate one diagram, check the AWS icons appear, and export a PNG.
   - Record the result in the tested-platforms table below, then `docker compose down -v` and `docker logout ghcr.io`.
   - If it fails, stop: fix it on a branch, release a patch version and repeat from step 1 for that version. Do not make the repository public.
6. Once step 5 passes, update the tested-platforms line in `docs/operations/installation.md` ("Tested on macOS (Apple silicon), Linux (CI) and Windows 11 on Arm."), and merge that change into `main` through a pull request (CI must be green).
7. Re-run the secret scan on all refs, now that the changelog date, the merges and the installation-guide change have landed. Expect "no leaks found". If anything is found, stop and do not make the repository public:
   ```bash
   docker run --rm -v "$PWD:/repo:ro" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --log-opts="--all" --redact --no-banner
   ```
8. Make the repository public: Settings, General, Danger Zone, Change visibility.
9. Make both GHCR packages public (Packages, package settings, Change visibility):
   - `ghcr.io/aliaksandr-liapin/cloudarchitect-lite/web`
   - `ghcr.io/aliaksandr-liapin/cloudarchitect-lite/gateway`

   Then check an anonymous pull works: `docker logout ghcr.io && docker pull ghcr.io/aliaksandr-liapin/cloudarchitect-lite/web:0.2.0` (and the same for `gateway`). Use the tag format the Release images workflow publishes. Also check the documented download works anonymously: `curl -fsSI https://raw.githubusercontent.com/aliaksandr-liapin/cloudarchitect-lite/v0.2.0/compose.yaml`.

10. Enable Pages: Settings, Pages, Source: GitHub Actions. Run `pages.yml` (Actions, Pages, Run workflow). Check <https://aliaksandr-liapin.github.io/cloudarchitect-lite/>. Publishing the GitHub release in step 13 also triggers this workflow.
11. Set the description and topics:

    ```bash
    gh repo edit aliaksandr-liapin/cloudarchitect-lite \
      --description "Describe your app, get an AWS architecture checked against 25 rules, on your own key. Self-hosted." \
      --homepage "https://aliaksandr-liapin.github.io/cloudarchitect-lite/" \
      --add-topic aws --add-topic architecture --add-topic diagram --add-topic llm \
      --add-topic claude --add-topic react-flow --add-topic self-hosted
    ```

12. Upload `docs/images/social-preview.png` (1280x640, already in the repository) in Settings, General, Social preview.
13. Publish the GitHub release for `v0.2.0` with the 0.2.0 section of `CHANGELOG.md` as the notes.
14. Before posting, confirm `docs/images/demo.gif` is on `main` (merged) and shows in the README; `devto.md` embeds it from `main`.
15. Post the drafts (`linkedin.md`, `devto.md`) after editing them.

## Tested platforms

| Platform            | How                                          | Status                            |
| ------------------- | -------------------------------------------- | --------------------------------- |
| macOS Apple Silicon | Built and run locally with Rancher Desktop   | tested by the builder             |
| Linux               | CI (install smoke and published-image smoke) | tested in CI                      |
| Windows 11 ARM      | Parallels, PowerShell install (step 5)       | to be hand-tested by the owner    |
| Windows x64         | Same multi-arch images                       | expected to work, not hand-tested |
