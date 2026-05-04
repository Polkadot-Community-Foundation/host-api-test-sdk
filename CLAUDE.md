# Claude Code instructions for host-api-test-sdk

## Release checklist

Every code change — bug fix, new feature, dependency bump, or breaking change — must update **all** of the following before it's considered done:

1. **`package.json`** — bump version (patch for fixes, minor for features, major for breaking)
2. **`CHANGELOG.md`** — add entry under the new version with what changed and why
3. **`forum-post.md`** — add section for the new version with user-facing explanation and code examples
4. **`README.md`** — update any examples, API references, or instructions that reference changed behavior

These are a single atomic unit with the code change. Do not ship code without updating all four.

## Cross-checking upstream

When bumping `@novasamatech/*` dependencies:
- Check `../triangle-js-sdks` git log between old and new version commits
- Verify the container `types.d.ts` for renamed/removed/added handlers
- Build, typecheck, and run integration tests before considering it done
- Update `../host-playground` if it uses the same APIs

## Testing

- `pnpm test` — export smoke tests (22 tests)
- `pnpm test:integration` — Playwright E2E tests (34+ tests) that exercise the full host-container ↔ product-sdk protocol
- Always run both after any change
- If the test product (`test/test-product.ts`) uses APIs that changed, update it and rebuild via `node test/build-test-product.mjs`

## Permission model

- Signing (`handleSignPayload`, `handleSignRaw`) is NOT gated behind any permission — real hosts don't do this
- `ChainSubmit` is enforced by the container at `transaction_broadcast` level (built-in, not in our handler)
- `StatementSubmit` and `PreimageSubmit` are enforced by the container via `makePermissionGatedRequestSlot`
- Our `handlePermission` handler processes individual `RemotePermission` requests (not batched)
