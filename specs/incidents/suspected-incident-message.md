# Suspected-incident alert message

Specification follow-up to [PR #242](https://github.com/TrekLink-Team/treklink-web/pull/242),
reviewed 2026-11-01. This contract awaits review and implementation. The current dispatcher still
sends MSG31 for transition alerts, including a `SUSPECTED` incident. No new SRS MSG number is
allocated here: the SRS catalog already uses MSG40 for group depth, while the incidents spec uses
it for device silence. Catalog reconciliation belongs to the leader's SRS revision.

## Trigger and recipients

Apply the distinct text to a transition alert for an incident whose confidence is `SUSPECTED` and
source is `CADENCE_INFERRED`. Creation follows REQ-EVT-02 and design §4: with no open incident,
`incidents.cadenceCount` plotted positions inside `incidents.cadenceWindowSeconds` open the incident.
The count uses occurrence times and includes both window edges. This is an inferred emergency;
no SOS text has confirmed it.

Keep design §3 routing: the current primary, backup or Manager tier receives its alert. An
`UNROUTED` incident alerts active TrekLink Staff and Admin accounts. Escalation keeps its existing
recipients. The distinct wording changes neither recipients nor channels, deadlines, permissions
or acknowledgement eligibility. Device-silent alerts remain governed by their separate contract.

## Displayed content

| Field | Contract |
|---|---|
| Message | `Suspected incident: {device} ({holder}), {time}. Acknowledge now.` |
| Device | Existing device asset-tag lookup; incident code fallback, as for MSG31 |
| Holder | Existing holder lookup; omit the parentheses when no holder is available |
| Time | Alert creation time, formatted in the configured display timezone, as for MSG31 |
| Presentation | Existing incident alert banner and one-step Acknowledge action; the visible text must identify the incident as suspected |
| Web inbox and email | Use the same suspected wording as the WebSocket alert |

The banner keeps existing dismiss, ownership-conflict, access and navigation behavior. This
specification adds no new severity, colour, pulse rule, rescue instruction or confirmation dialog.

## Subsequent events

A later SOS upgrades the same incident to `CONFIRMED` in place under REQ-EVT-02. It emits
`incident.changed`; it does not create another incident, transition or set of alert rows. New
transition alerts for a confirmed incident use MSG31. The existing contracts do not define rewriting
an already displayed alert on an upgrade; that behavior is left for review before implementation.

Positions joining an open episode do not create another alert. After an episode closes, a new
qualifying burst may open a fresh suspected incident, as documented in design §4. A short simulator
interval can therefore produce these alerts without an SOS; see the Configuration Matrix warning.

## Verification required when implemented

- A cadence-created episode sends the suspected wording to its routed recipients.
- Missing holder information omits empty parentheses; time uses the configured timezone.
- Confirmed SOS and device-silent alerts retain their existing wording and actions.
- A later SOS upgrades the incident without duplicate alert rows.
- WebSocket, web inbox and email agree on the suspected wording.

Sources: incidents requirements REQ-EVT-02/03 and AC-05; design §3 to §5;
`incident-ingress.ts` (`openSuspected`, `append`); `alerts/alert-dispatcher.job.ts`
(`msg31`, `payloads`); frontend screen 8.1; SRS §5.3 message catalog.
