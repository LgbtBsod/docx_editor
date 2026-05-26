# Accessibility Execution Checklist (Desktop SAP UI5 Mass Mail)

## Scope
- Screen: `webapp/view/Main.view.xml`
- Focus: keyboard-only navigation, visible focus, screen-reader labels, dialog lifecycle.

## Execution steps
1. Keyboard-only walkthrough
   - Tab through header actions, content source selector, editor toolbar, recipient controls, send actions.
   - Verify all actionable controls are reachable and operable via keyboard.
2. Editor accessibility
   - Verify editor container has role/ARIA metadata.
   - Verify focus ring is visible when editor is active.
3. Dialog accessibility
   - Open/close news dialog, preflight dialog, and document-link dialog.
   - Verify focus moves into dialog and returns to trigger on close.
4. Error/feedback semantics
   - Trigger validation errors for recipients/attachments/links.
   - Verify messages are announced and understandable.
5. Contrast and scaling
   - Check default desktop zoom 100% and 125%.
   - Verify no clipping in splitter/layout regions.

## Pass criteria
- No keyboard trap.
- No inaccessible critical action.
- Dialogs cleanly close and release focus.
- No blocker-level screen-reader issue in primary send flow.

## Result template
- Date:
- Tester:
- Browser/version:
- Outcome: PASS / FAIL
- Notes:
