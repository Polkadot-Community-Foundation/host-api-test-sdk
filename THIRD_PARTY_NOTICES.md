# Third-party notices

`@parity/host-api-test-sdk` is distributed under the [MIT License](./LICENSE) and bundles, links to, or depends on a number of open-source components. This file lists the libraries inlined into the browser bundle (`dist/host-bundle.js`) and the runtime / peer dependencies.

All bundled and runtime dependencies are licensed under permissive terms (MIT or Apache-2.0). No copyleft (GPL / AGPL / LGPL) licenses are present in the production dependency surface as of the audit on 2026-06-08.

## Bundled into `dist/host-bundle.js`

These packages are inlined into the test host's browser bundle by esbuild and ship with every install.

- **@novasamatech/host-api** — Apache-2.0 — https://github.com/paritytech/triangle-js-sdks
- **@novasamatech/host-container** — Apache-2.0 — https://github.com/paritytech/triangle-js-sdks
- **@polkadot/keyring** — Apache-2.0 — https://github.com/polkadot-js/common
- **@polkadot/types** — Apache-2.0 — https://github.com/polkadot-js/api
- **@polkadot/util** — Apache-2.0 — https://github.com/polkadot-js/common
- **@polkadot/util-crypto** — Apache-2.0 — https://github.com/polkadot-js/common
- **neverthrow** — MIT — https://github.com/supermacro/neverthrow
- **polkadot-api** — MIT — https://github.com/polkadot-api/polkadot-api

## Runtime dependency

- **@novasamatech/host-api** — Apache-2.0 (declared in `package.json` as a runtime dependency for consumer ESM imports).

## Peer dependency

- **@playwright/test** — Apache-2.0 — https://github.com/microsoft/playwright (only required when using the Playwright fixture entry point).

## Apache-2.0 attribution

Copies of the Apache License 2.0 are available from each upstream repository linked above. No NOTICE files were present in the bundled tree at audit time; if upstream adds one, it should be reproduced here on the next dependency bump.

## Regenerating

```bash
npx --yes license-checker-rseidelsohn --json
```

Re-run after any dependency bump and update the lists above if licences change or new bundled packages are introduced.
