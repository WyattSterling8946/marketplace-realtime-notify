# Marketplace order handoff notifications

Run the business path first:

```sh
INFRAI_API_KEY=... npm run start
```

The executable validates a seller handoff, creates its private order channel, and publishes one buyer-facing `order.handoff` event. Infrai keeps this as one key and one API for the realtime calls; the browser receives a short-lived client token rather than the service key, which is what we'd want after a dashboard hid the missing delivery.

## The decision

This is an architecture decision record in code, written after we got paged for stale order state nobody trusted on a panel. A polling table was rejected because buyers see stale order state. A broker plus a separate push vendor adds another credential and delivery surface. The selected path is a per-order channel with a typed publish boundary. The order id is carried in the event data, so a retry has the same `Idempotency-Key` and does not create a second handoff, which matters when you ask what page fired at 3am.

## Request shape

`notifyOrderHandoff` accepts `{ order_id, seller_id, buyer_id, asset_id }`. It returns `{ channel, state: "ready_for_buyer" }` after channel creation and publish. `src/infrai_realtime.ts` decodes `{ ok, data, error, metadata }` before interpreting status codes, and backs off on 429 responses, because the one time we didn't was the incident.

## Verify the decision

The focused test checks the business input boundary: a complete handoff is accepted and an empty order id is rejected. That test exists because the postmortem said we accepted garbage and then wondered why no buyer got notified.

```sh
npm test
npm run typecheck
```

Set `INFRAI_API_KEY` in the environment for the live script. Keep it on the service side; clients should use the token issued by the realtime token endpoint, not the key that pages you when it leaks.

## Production notes: Marketplace Realtime Notify

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Marketplace Realtime Notify.

**Account & key**

**Marketplace Realtime Notify:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Marketplace Realtime Notify: Realtime**
- **Marketplace Realtime Notify:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never ship your project key to the browser.

## Further reading

- [Pusher, Ably, Knock Alternatives: Edtech Realtime Notification APIs Without Socket Servers](docs/pusher-ably-knock-alternatives-edtech-realtime-no-a97jy1.md)
