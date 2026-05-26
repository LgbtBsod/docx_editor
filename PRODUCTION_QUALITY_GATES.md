# Production Quality Gates (Desktop SAP UI5 Mass Mail)

## Mandatory checks before release

> Prerequisite: project-level `package.json` and scripts must exist.
> Current repository snapshot does not contain `sap-mass-mail/package.json`, so npm-based gates are currently non-runnable in this environment.
1. Lint
   - `npm run lint`
2. Unit tests
   - `npm test`
3. Build
   - `npm run build`
4. Manual smoke (desktop)
   - Open `webapp/index.html`
   - Verify template load (DOCX), recipient import/search, preview, preflight, test send, mass send.

## Exit criteria
- All commands pass with exit code 0.
- No console errors during smoke flow.
- No hardcoded user-facing strings in controller/view (except mocked business content).
- No direct CSS overrides of SAP internal classes.


## Environment fallback checks (when npm scripts are unavailable)
- Validate JS syntax for critical modules with Node parser check.
- Verify XML/fragment references and i18n bindings via `rg` checks.
- Run repository smoke checklist manually in desktop browser.
