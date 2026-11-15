# Institution Onboarding Checklist

> **Draft for legal review — version {{VERSION}}.** Prepared as a working template. Before publishing, have a lawyer qualified in each country where you operate review and adapt it, and fill every [bracketed] item.

**Legal and governance**
- [ ] Officer with authority accepts the DPA and Terms at registration (recorded automatically).
- [ ] Signed letter of authority on letterhead sent to {{DPO_EMAIL}}.
- [ ] Contact email is on the institution's official domain.
- [ ] Institution DPO named.
- [ ] Institution confirms its regulator registration status (e.g. NDPC DCPMI registration and annual compliance audit return, Kenya ODPC registration, Ghana DPC registration, South Africa Information Officer).
- [ ] Privacy notice to students and staff updated to mention SOS Connect (template: our Privacy Policy).
- [ ] Guardian-consent process for under-18 members agreed.

**Technical**
- [ ] Connector installed on a server next to the student/staff database, behind HTTPS.
- [ ] Read-only database user limited to the needed tables.
- [ ] Connector IP allow-list set to SOS Connect's server addresses.
- [ ] Connector test passes in Institution settings.
- [ ] Optional: edge nodes on key Wi-Fi access points (`php artisan sos:edge-token`).

**Safety operations**
- [ ] Campus security phone number set.
- [ ] Responder roles (SECURITY) assigned and on a rota; VC/Registrar receive escalations.
- [ ] Responders trained on the SOS console and on false-alarm handling.
- [ ] Test drill: an SOS raised offline in a dead zone reaches the console through the mesh.

**Communication**
- [ ] Students and staff told how SOS works, its limits, and the national emergency numbers.
