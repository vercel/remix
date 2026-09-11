# Releasing Vercel's Remix packages

The `.github/workflows/publish.yml` workflow publishes `@vercel/remix` and `@vercel/remix-run-dev` using npm trusted publishing. It runs on `main` in `vercel/remix`, either through a manual dispatch or a dispatch from the upstream sync workflow.

## Configure npm trusted publishers

An npm package administrator must configure a trusted publisher for **each package** with these values:

| npm setting                 | Value          |
| --------------------------- | -------------- |
| CI/CD provider              | GitHub Actions |
| GitHub organization or user | `vercel`       |
| Repository                  | `remix`        |
| Workflow filename           | `publish.yml`  |
| Environment name            | Leave blank    |
| Allowed action              | `npm publish`  |

Enter only `publish.yml`, not `.github/workflows/publish.yml`. If you rename the workflow or add a GitHub environment, update the npm configuration to match before publishing.

The publish job runs on a GitHub-hosted runner with `id-token: write`. It doesn't use `NPM_TOKEN_ELEVATED` or `NODE_AUTH_TOKEN`. npm exchanges the GitHub OpenID Connect (OIDC) identity for short-lived publishing credentials and automatically generates provenance attestations.

## Run a release

1. Configure trusted publishing for both packages on npm.
2. Open the **Publish @vercel/remix and @vercel/remix-run-dev** workflow in GitHub Actions and select **Run workflow** on `main`.
3. Leave `version-postfix` blank for the versions in the package manifests, or enter a postfix such as `patch.1`. The postfix applies to both packages. Ensure neither resulting version already exists on npm. Both publish to the `latest` tag, matching the existing release behavior.
4. Verify that both versions appear on npm with provenance linked to `vercel/remix` and `publish.yml`.
5. Verify that the downstream update workflow in `vercel/vercel` starts.

The build continues to use the Node.js version in `.nvmrc` and pnpm 8.10.5. Publishing switches to Node.js 22.14.0 and npm 11.5.1, which support trusted publishing. Packages are packed with pnpm first so `workspace:*` dependencies become version references. The release script also updates the dev package's repository URL to this fork for provenance.

The `GH_TOKEN_PULL_REQUESTS` secret is still required for the downstream GitHub workflow dispatch. After verifying trusted publishing, revoke the old npm publishing token if no other workflows use it.

See npm's [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for package administration details.
