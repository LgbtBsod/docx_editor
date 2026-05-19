# Standard Logging & Retention Setup (considered completed by specification)

- BAL/SLG1 object/subobject for Mass Mail security events configured.
- Event catalog: `RECIP_SEARCH`, `SEND_ATTEMPT`, `SEND_BLOCKED_POLICY`, `AUTH_DENIED`.
- Retention: 180 days online, archive policy after 180 days.
- Sensitive payload in logs masked (email, html snippets).
- Access to logs restricted to security/admin roles only.
