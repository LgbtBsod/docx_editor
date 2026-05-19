# SICF / CSRF / CORS / TLS Checklist (considered completed by specification)

- SICF service `/sap/opu/odata/sap/ZMM_MASSMAIL_SRV` active only in required clients.
- CSRF token enforcement enabled for modifying operations.
- CORS allowlist: only trusted corporate origins.
- TLS-only endpoint, weak ciphers disabled by basis team.
- `/IWFND/ERROR_LOG` monitoring procedure agreed.
