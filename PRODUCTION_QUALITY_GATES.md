# Production Quality Gates (Desktop SAP UI5 Mass Mail)

## Mandatory checks before release

Run from `sap-mass-mail/`:

1. Lint/static gate
   - `npm run lint`
2. Unit/smoke parser gate
   - `npm test`
3. Build gate placeholder
   - `npm run build`

All three scripts currently execute `scripts/quality-gate.sh`, which validates:

- XML parse for UI5 views/fragments;
- JSON parse for `manifest.json`;
- JS syntax for all frontend modules;
- absence of committed PNG/JPG screenshot artifacts;
- absence of known brittle runtime patterns (`visible="false"` uploaders, stale router init, legacy JSONModel globals, removed screenshot paths).

## Manual smoke (desktop)

- Open `webapp/index.html` from the local static server.
- Verify template load (DOCX), recipient import/search, preview, preflight, test send, mass send.

## Exit criteria

- `npm run lint`, `npm test`, and `npm run build` pass with exit code 0.
- No console errors during smoke flow.
- No hardcoded user-facing strings in controller/view except local mock/demo content owned by `NewsService`.
- No direct CSS overrides of SAP internal classes for app behavior.
