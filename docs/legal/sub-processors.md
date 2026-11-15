# Sub-processors

> **Draft for legal review — version {{VERSION}}.** Prepared as a working template. Before publishing, have a lawyer qualified in each country where you operate review and adapt it, and fill every [bracketed] item.

| Provider | Purpose | Data | Location | Safeguard |
| --- | --- | --- | --- | --- |
| [Cloud host, e.g. a provider with an African or EU region] | servers, database, file storage, backups | all service data | [country/region] | DPA + [SCCs / adequacy] |
| Expo (650 Industries, Inc.) | delivering push notifications to phones | push token, notification title/short text | United States | DPA + SCCs; SOS notifications contain no location |
| Apple Push Notification service / Google Firebase Cloud Messaging (via Expo) | final delivery to iOS/Android | push token, notification text | United States / global | platform terms + SCCs |
| [Email provider] | account and admin emails | email address, email content | [country] | DPA |
| [TURN relay host] | relaying call audio/video when direct connection fails | encrypted media packets, IP addresses | [country] | DPA; media is end-to-end encrypted by WebRTC (DTLS-SRTP) |
| [Error monitoring, optional] | crash and error reports, scrubbed of message content | technical data | [country] | DPA |

Map links in SOS alerts open OpenStreetMap or Google Maps in the responder's browser; coordinates are not sent to those services by SOS Connect itself. We give 30 days' notice of changes to institutions.
