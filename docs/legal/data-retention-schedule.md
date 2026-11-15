# Data Retention Schedule

> **Draft for legal review — version {{VERSION}}.** Prepared as a working template. Before publishing, have a lawyer qualified in each country where you operate review and adapt it, and fill every [bracketed] item.

Retention is applied automatically every night (`php artisan sos:prune`). Institutions can set **shorter** periods in their settings, never longer. Data under a legal hold (investigation, litigation, regulator request) is kept until the hold ends.

| Data | Default period | Why | What happens after |
| --- | --- | --- | --- |
| Chat messages and files | 12 months | communication record | permanently deleted |
| Deleted messages | content removed immediately; row deleted with the period above | integrity of conversations | permanently deleted |
| Status updates | 24 hours (+1 day buffer) | short-lived by design | deleted |
| SOS alerts and responder actions | 24 months | safety investigations, institution duty of care | deleted |
| Precise SOS location | 30 days after the alert closes | find the person | blurred to ~1 km |
| Safety-check answers | 12 months | incident follow-up | deleted |
| Call logs (metadata only) | 6 months | missed-call history, abuse handling | deleted |
| Offline envelopes uploaded by gateways | 7 days | de-duplication | deleted |
| Envelopes carried on phones | 2 days (messages) / 3 days (SOS) | relay window | deleted on the phone |
| Audit and security logs | 24 months | accountability, investigations | deleted |
| Accounts of members who left | 12 months after leaving | re-admission, disputes | deleted or anonymised |
| Data on a phone after sign-out | 0 | — | wiped from the phone at sign-out |
| Backups | 35 days rolling | disaster recovery | overwritten |
