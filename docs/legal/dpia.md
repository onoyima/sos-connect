# Data Protection Impact Assessment (summary)

> **Draft for legal review — version {{VERSION}}.** Prepared as a working template. Before publishing, have a lawyer qualified in each country where you operate review and adapt it, and fill every [bracketed] item.

A DPIA is required because the service processes location and possibly health data, involves vulnerable people (possibly minors), uses a novel technology (phone-to-phone relay), and operates at scale (NDPA s.28; GDPR art.35; GAID).

## Description
Institution-based chat, calls and SOS alerts that work online and offline. Logins verified by the institution's connector; no passwords stored. Offline relay by Bluetooth/Wi-Fi with signed, encrypted packages.

## Necessity and proportionality
Purpose — safety and communication of a defined community. Minimisation — only membership attributes needed for groups and roles; DOB used transiently; location only on SOS/safety answers with an opt-out; statuses expire in 24 h; retention schedule enforced automatically.

## Risks and mitigations
| Risk | Likelihood / severity | Mitigation | Residual |
| --- | --- | --- | --- |
| Outsiders read chats or alerts | low / high | tenant isolation in every query; membership checks on every route and channel; encrypted relay packages | low |
| Forged SOS or impersonation offline | medium / high | platform-signed device certificates; every hop verifies signatures; per-sender rate limits; revocation through key rotation | low |
| Relaying phones read others' data | medium / high | institution-key and per-device encryption; foreign institutions carry ciphertext only | low |
| Location over-sharing | medium / medium | only on SOS/safety answer; member can disable; blurred after 30 days; visible to responders and nearby members only during an alert | low–medium |
| Minors' data | medium / high | under-18 flag, guardian consent recorded by institution, restricted features until consent | medium (depends on institution) |
| False sense of safety (alerts not delivered) | medium / high | clear SOS notice; multi-channel delivery; escalation after 2 minutes; SMS and phone-call fallbacks | medium |
| Institution staff surveillance of private chats | low / high | no silent-join or bulk-read tools; reported content only; admin actions audited | low |
| Cross-border transfer | medium / medium | SCCs/adequacy; optional in-country hosting | low |
| Breach of connector | low / high | HMAC + nonce + timestamp; read-only DB user; IP allow-list; no password storage on our side | low |

## Conclusion
Processing may proceed with the mitigations above. Review annually and after major changes. Consult the regulator if a high residual risk remains (NDPA s.28(3); GDPR art.36).
