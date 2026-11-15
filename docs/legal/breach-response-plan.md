# Personal Data Breach Response Plan

> **Draft for legal review — version {{VERSION}}.** Prepared as a working template. Before publishing, have a lawyer qualified in each country where you operate review and adapt it, and fill every [bracketed] item.

| Step | Who | When |
| --- | --- | --- |
| 1. Detect & log (alerts, reports to {{DPO_EMAIL}}, staff discovery) | on-call engineer | immediately |
| 2. Contain: revoke tokens/keys, rotate secrets (`sos:platform-keys`, mesh keys, connector secrets), block access | on-call + security lead | within 1 hour where possible |
| 3. Assess: what data, how many people, which institutions and countries, likelihood of harm | DPO | within 12 hours |
| 4. Notify affected institutions (controllers) with known facts | DPO | **within 24 hours** of awareness |
| 5. Institution notifies regulator if the breach is likely to risk people's rights | institution (we help draft) | **within 72 hours** (NDPA s.40; GDPR art.33; POPIA s.22 "as soon as reasonably possible"; Kenya s.43 72 hours) |
| 6. Inform affected people in clear language when high risk | institution, with our help | without undue delay |
| 7. Fix root cause; post-incident review; update DPIA and this plan | engineering + DPO | within 30 days |

Keep a breach register (date, facts, effects, actions, notifications) for every incident, including those not notified.

Specific scenarios: **lost/stolen phone** — member or admin revokes the device; mesh keys rotate at next sync. **Compromised connector secret** — institution rotates it in settings; old secret stops immediately. **Platform signing key exposure** — generate new keys, ship an app update pinning the new public key, re-issue certificates at next sign-in.
