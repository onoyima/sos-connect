# Data Processing Agreement

> **Draft for legal review — version {{VERSION}}.** Prepared as a working template. Before publishing, have a lawyer qualified in each country where you operate review and adapt it, and fill every [bracketed] item.

Between the **Institution** named at registration ("Controller") and **{{OPERATOR}}**, {{ADDRESS}} ("Processor"). Accepted electronically at registration by an officer who confirmed authority to bind the Institution; the acceptance, version, name, title, time and IP address are recorded.

This Agreement meets the requirements of the Nigeria Data Protection Act 2023 (NDPA) (including s.29) and the NDPC General Application and Implementation Directive 2025 (GAID); GDPR article 28 where GDPR applies; the Kenya Data Protection Act 2019; Ghana's Data Protection Act 2012 (Act 843); and South Africa's POPIA (operator provisions, ss.20–21).

## 1. Subject matter and duration
Providing SOS Connect to the Institution's members for as long as the Institution's account is active, plus the return/deletion period in clause 10.

## 2. Nature and purpose
Hosting, transmitting and storing messages, files, calls metadata, SOS alerts, safety checks and announcements; verifying members' logins through the Institution's connector; delivering push notifications; operating the offline relay.

## 3. Categories of data subjects and data
Students, staff and invited guests of the Institution. Membership data (name, institutional identifiers, official email/phone, role, faculty, department, level, active status, under-18 flag), content, SOS/location data, call metadata, device data, technical logs. **Special-category data** may appear in content or SOS alerts (e.g. health); the Processor treats all content as sensitive.

## 4. Controller obligations
The Controller: has a lawful basis for the processing and gives members the privacy information; obtains and records parent/guardian consent for members under 18 where required; decides who may use the service and appoints responders; keeps its connector secure and its member records accurate; registers with its regulator where required (for example, as a Data Controller of Major Importance with the NDPC); and gives only lawful instructions.

## 5. Processor obligations
The Processor:
1. processes personal data only on documented instructions (this Agreement and the Institution's settings), unless required by law, in which case it informs the Controller first unless the law forbids it;
2. ensures everyone with access is bound by confidentiality;
3. implements the security measures in Annex 1;
4. uses sub-processors only under clause 6;
5. helps the Controller respond to data-subject requests, DPIAs and regulator enquiries;
6. notifies the Controller of a personal data breach **without undue delay and in any case within 24 hours** of becoming aware, so the Controller can meet its 72-hour duty (NDPA s.40; GDPR art.33);
7. deletes or returns data at the end of the service (clause 10);
8. makes available the information needed to demonstrate compliance and allows audits (clause 9);
9. never sells personal data or uses it for advertising or to train AI models.

## 6. Sub-processors
General authorisation is given for the sub-processors listed on the Sub-processors page. The Processor gives at least **30 days'** notice of additions or replacements; the Controller may object on reasonable data-protection grounds, and if no solution is found may terminate without penalty. The Processor imposes the same obligations on sub-processors and remains liable for them.

## 7. International transfers
Transfers outside the Controller's country happen only under clause 7 of the International Data Transfers page, relying on adequacy, standard contractual clauses or other safeguards recognised by the applicable law. The Processor will provide a transfer impact assessment on request.

## 8. Access by public authorities
The Processor will challenge requests it considers unlawful, disclose only the minimum required, and notify the Controller unless legally prohibited. It will not build backdoors or provide bulk access.

## 9. Audits
Once a year (or after a breach), on 30 days' notice, the Controller may audit compliance, primarily through the Processor's reports and certifications; on-site audits at the Controller's cost and subject to confidentiality.

## 10. End of service
Within **30 days** after termination the Processor returns (via export) or deletes the Controller's personal data, including backups within their normal rotation (max 35 days), unless the law requires retention, and confirms deletion in writing.

## 11. Liability
As agreed in the main service agreement, without limiting liability that cannot be limited by law.

## Annex 1 — Security measures
- TLS 1.2+ for all traffic; HSTS. Message bodies encrypted at rest (AES-256 via application keys). Connector secrets and mesh keys encrypted at rest.
- Offline packages signed (Ed25519) and encrypted (XSalsa20-Poly1305); direct messages sealed per recipient device (X25519); platform signing key kept only on the server.
- No storage of institution passwords; connector requests HMAC-signed, timestamped and single-use.
- Tenant isolation enforced at the data layer for every query; role-based permissions; scoped HOD/Dean views.
- Immediate effect of suspensions (tokens revoked, devices revoked, mesh keys rotated).
- Rate limits per user and per login; audit logs of administrative actions retained 24 months.
- Daily encrypted backups, tested restores; least-privilege staff access with logging; vulnerability patching within 14 days for high severity.
- Incident response plan (Breach Response Plan page); annual review of these measures.

## Annex 2 — Instructions recorded in the Institution's settings
Retention periods (may be shortened), whether foreign institutions may relay encrypted alerts, whether students may create groups, maximum status audience, responder roles, campus security number.
