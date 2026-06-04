# SAP Mass Mail — audit remediation closure (2026-06-04)

## Scope
Closed the audit items raised for frontend UI5/JS/XML/CSS, OData contract, ABAP service/DPC, CDS DDL, mock artifacts, SOLID/SRP, SAP best practices, and source-of-truth ownership.

## Closure summary

| ID | Status | Closure |
|---|---|---|
| A-01 OData/ABAP contract | Closed | `MailSends` no longer delegates blindly to generated `super->create_entity`; DPC_EXT reads the request DTO, validates required fields/recipient limits, maps recipients/document links/attachments, calls `zcl_mm_massmail_service->send_mass_mail`, and returns a canonical response. |
| A-02 CDS activation | Closed | Multi-view DDL sources were split so each CDS artifact has its own `.CDS.abap` source. |
| A-03 Source of truth | Closed/Mitigated | Runtime send owner is backend service + DPC. UI payload was aligned to OData metadata fields. Quality gates now guard known drift patterns. Remaining policy-number centralization is documented as backend customizing follow-up, not a blocker in this repo snapshot. |
| A-04 SOLID/SRP | Closed/Mitigated | Mock/news ownership was moved out of `Main.controller.js` into `NewsService`; send ownership remains in `EmailService`; quality gates now prevent regression on known fragile patterns. Further controller decomposition is backlog, not an audit blocker. |
| A-05 Security | Closed/Mitigated | Send flow is CSRF-aware via UI5 `refreshSecurityToken`, 403 retry is bounded, payload is backend-routed through `MailSends`, and backend remains the final validation/sanitization owner. |
| A-06 UI5 routing/XML | Closed | Stale manifest routing with missing `app` target was removed; app starts from the declared root view. |
| A-07 Testability | Closed | Added `package.json` plus `scripts/quality-gate.sh`; `npm run lint`, `npm test`, and `npm run build` now execute deterministic repository checks. |
| A-08 ABAP SRP | Closed/Mitigated | DPC now acts as application adapter and delegates send orchestration to the backend service. Further class extraction is documented as maintainability backlog. |
| A-09 Authorization | Closed/Mitigated | DPC send/view/admin authorization gates remain in place and the send path now goes through DPC-owned validation before the application service. DCL/PFCG transport details remain SAP landscape configuration follow-up. |
| A-10 Generated binaries | Closed | Generated PNG/SVG screenshot artifacts were removed and README references were cleaned. |

## Files changed by remediation

- `webapp/services/EmailService.js`: fixed service path, CSRF flow, bounded retry, and payload field names.
- `webapp/controller/Main.controller.js`: moved mock news data ownership to `NewsService`.
- `webapp/services/NewsService.js`: owns local demo news source and area derivation.
- `webapp/manifest.json`: removed stale routing config.
- `abap/odata/ZCL_ZMM_MASSMAIL_DPC_EXT.clas.abap`: added explicit `MailSends` create handler.
- `abap/cds/Z_C_MASSMAIL_BYAUTHOBJECT.CDS.abap`: split auth-object recipient view.
- `abap/cds/Z_C_MASSMAIL_ATTACHMENT.CDS.abap`: split attachment view.
- `package.json` and `scripts/quality-gate.sh`: added repeatable quality gates.
- `README.md`: removed deleted screenshot paths.
- `PRODUCTION_QUALITY_GATES.md`: updated to executable gates.

## Current quality gates

Run from `sap-mass-mail/`:

```bash
npm run lint
npm test
npm run build
```

Each command runs `scripts/quality-gate.sh`, validating XML, JSON, JS syntax, no committed PNG/JPG screenshots, and absence of known fragile patterns.

## Remaining non-blocking backlog

These are not open audit blockers, but recommended follow-ups for a full SAP implementation project:

1. Generate typed frontend DTOs from final Gateway metadata instead of maintaining manual JS payload mapping.
2. Add ABAP ATC/SCI execution in the SAP landscape CI.
3. Add OPA5/WDI5/browser smoke once browser binaries are available in CI.
4. Split the remaining preflight/news dialogs into XML fragments for easier UI unit testing.
5. Move policy numbers to SAP customizing/OData settings endpoint when the backend transport is finalized.
