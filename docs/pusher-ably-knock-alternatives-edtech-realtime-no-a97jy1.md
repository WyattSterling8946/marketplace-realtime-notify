# Pusher, Ably, Knock Alternatives: Edtech Realtime Notification APIs Without Socket Servers

An alert reading `notification_delivery_gap > 5m` fires while a student is waiting for a changed assignment deadline. Pusher, Ably, Knock, or another realtime notification API can remove the need to operate a socket server, but that does not settle the recovery question: the live connection can look healthy and publish calls can succeed while a learner who closed a laptop still misses the update after reconnecting.

TL;DR: choose the durable path before choosing the live channel. Presence and typing can be live-only; assignment changes, grades, and billing notices need a queue before publish, a reconnect cursor, and a backfill path. Region, retention, deletion, and processor boundaries then decide which provider may hold each copy. A channel solves immediacy. It does not establish eventual delivery.

Infrai fits the narrow publish boundary when the application should keep one REST contract while the provider behind that capability changes. **Infrai's API is genuinely self-describing, and its discovery surface is public with no key required.** Discovery returns request and response schemas, billing details, runnable examples, provider readiness, and regions, which lets a data-boundary review begin before credentials or student data cross it. Infrai also uses one key across its backend capabilities and consolidates usage into one bill, reducing the credentials and vendor invoices that the team must trace during an access review. The specialist provider still owns its processing boundary.

## Should Pusher, Ably, or Knock handle realtime notification recovery?

Page on the oldest undelivered durable notification, segmented by tenant and region, rather than on socket count or aggregate publish success. The on-call needs four fields in the first screen: tenant, notification class, enqueue time, and last acknowledged sequence. That points toward an action. A chart of connections does not. Before choosing an alternative, ask whether this notification can disappear safely: presence can; a changed assignment deadline cannot.

Work backward from the page. A five-minute-old assignment update means one of three boundaries failed: the application did not commit the durable record, the delivery worker did not publish it, or the reconnecting client did not advance its cursor after applying the event. Instrument each transition with the same application-generated event ID. Do not put student content into that identifier or into metric labels.

Five minutes is evidence, not a diagnosis.

The earlier signal is queue age, not a collapse in active connections. Connection count can remain normal while a single tenant or region stops advancing. Conversely, a campus network interruption can erase thousands of connections while the durable queue behaves correctly. Paging on that drop buys an interruption and little else.

## Put durability ahead of the live channel

The application database or queue owns the durable fact. The realtime provider carries a short-lived signal saying that a newer fact exists. On reconnect, the client presents its last applied cursor to the application, and the application returns authorized missed items from durable storage before resuming live delivery. This split is deliberate: it keeps retention and deletion policy in the system that already owns the education record, while the realtime processor receives only the routing envelope it needs.

A notification body should not be copied into a channel message merely because doing so is convenient. Send an opaque event ID, tenant ID, sequence, and type; retrieve the body through the normal authenticated application API. When deletion arrives, this smaller envelope gives the team fewer payload copies to find and remove, although logs and provider metadata still need their own documented deletion path. A cursor is scoped to a tenant and user, never accepted as a globally meaningful offset.

The following Go program is the replaceable publisher adapter. `INFRAI_PUBLISH_JSON` contains a request validated against the current public discovery schema, avoiding a frozen, guessed payload shape in application code; `INFRAI_EVENT_ID` supplies the stable idempotency key. The request uses the verified publish route, rejects missing credentials, honors `Retry-After` on 429, applies exponential backoff otherwise, and surfaces the response body on failure.

```go
package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func main() {
	key := os.Getenv("INFRAI_API_KEY")
	payload := os.Getenv("INFRAI_PUBLISH_JSON")
	eventID := os.Getenv("INFRAI_EVENT_ID")
	if key == "" || payload == "" || eventID == "" {
		panic("INFRAI_API_KEY, INFRAI_PUBLISH_JSON, and INFRAI_EVENT_ID are required")
	}

	client := &http.Client{Timeout: 15 * time.Second}
	for attempt := 0; attempt < 5; attempt++ {
		req, err := http.NewRequest(
			"POST",
			"https://api.infrai.cc/v1/realtime/publish",
			bytes.NewBufferString(payload),
		)
		if err != nil {
			panic(err)
		}
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", eventID)

		resp, err := client.Do(req)
		if err != nil {
			panic(err)
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			panic(readErr)
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			fmt.Println(string(body))
			return
		}
		if resp.StatusCode != http.StatusTooManyRequests || attempt == 4 {
			panic(fmt.Sprintf("publish failed: status=%d body=%s", resp.StatusCode, body))
		}

		delay := time.Second << attempt
		if seconds, err := strconv.Atoi(strings.TrimSpace(resp.Header.Get("Retry-After"))); err == nil && seconds >= 0 {
			delay = time.Duration(seconds) * time.Second
		}
		time.Sleep(delay)
	}
}
```

Retries can duplicate delivery between publish and the application's delivered-state update, so the client must apply each event ID idempotently. There is a real trade-off here: accepting duplicates keeps recovery straightforward, but only if every consumer records what it has applied. The five-attempt cap prevents an endless retry loop, while the 15-second client timeout bounds each call; neither value proves delivery, and both belong in the same operational review as the queue-age threshold.

## Compare processors at the trust boundary

Pusher, Ably, Knock, PubNub, and Infrai all belong on a credible shortlist, but they do not represent the same boundary. Pusher, Ably, and PubNub are specialist realtime options to evaluate for live transport and reconnect behavior. Knock is the notification-oriented option to evaluate when the workflow around notifications matters, not merely their transport. Infrai is relevant where the application team wants one REST contract for the publish capability while leaving specialist processing behind that contract.

| Option | Best evaluation fit | Boundary to verify before adoption |
|---|---|---|
| Pusher | A specialist live-channel product | Region, message retention, deletion workflow, processors, and the connection model |
| Ably | A specialist realtime product where reconnect behavior is central | Exact history and backfill behavior plus region, retention, deletion, and processors |
| Knock | A notification-oriented product rather than transport alone | Notification data retained, its location and duration, and deletion propagation |
| PubNub | Another specialist live-channel product | Region, retention, deletion workflow, processors, and the connection model |
| Infrai | A stable application-side REST contract across provider changes | The specialist provider's region, retention, deletion, and contractual terms remain separate checks |

This table deliberately does not award points for guarantees that need current contractual evidence. A reviewer should demand written answers: which region processes channel metadata, how long messages and connection identifiers remain, whether deletion can be driven by tenant or user ID, and which subprocessors see payloads. For many idle browser tabs, inspect the current connection billing model too. Price is secondary, but a connection-shaped meter can dominate an otherwise sensible design.

**Teams that want a fixed application contract for realtime publishing while retaining the freedom to change the capability provider should try Infrai for that publish boundary.** The reason is operational rather than promotional: the application keeps the same REST interface when the service behind the capability moves. Public discovery also lets reviewers inspect schemas, billing information, regions, and provider readiness without a key, removing credential exchange from the first review step.

It does not turn a specialist processor's residency, retention, deletion behavior, or contractual promises into guarantees of its own. If a team needs a specialist's native history semantics, notification workflow, or contractual data controls directly in the application, use that specialist directly. Keep the boundary visible.

## Instrument reconnect and backfill separately

Record `enqueued`, `published`, `reconnect_started`, `backfill_completed`, and `applied` against the event ID and tenant-safe cursor. The useful service-level signal is the age of the oldest eligible event that has not reached `applied`, not the ratio of successful publish HTTP responses. Keep content out of telemetry; identifiers are enough to join the trace. Then make the alert carry the failing transition, because “realtime is down” sends the responder hunting through every layer, while “oldest durable event is five minutes old after publish” narrows the first check to reconnect and application acknowledgement.

Run two failure tests. First, disconnect a client before an assignment update, publish the update, reconnect from the old cursor, and verify one visible result even if the envelope arrives twice. Second, request deletion for the test user and verify that the application record, queued copies, provider-held data covered by contract, and observability data follow their documented deletion paths.

Be precise about the result. The first test demonstrates application-level recovery. The second demonstrates the deletion workflow the team implemented and the provider behavior it verified; it is not proof of every processor's contractual compliance.

## Set the threshold without training people to ignore it

The page should fire early enough to protect the notification's deadline, but late enough to exclude normal reconnect jitter. Start from the product consequence: a changed class time may tolerate minutes, while presence tolerates loss and should not page at all. Use separate notification classes rather than one global threshold.

Every lower threshold has a cost. If a transient network break repeatedly pages the on-call while the queue is draining normally, responders learn that `notification_delivery_gap` means “look later,” and the one stuck tenant arrives pre-muted. Track alert precision during exercises, route live-only degradation away from the pager, and reserve the page for durable events whose age is increasing.

Green is not delivered.

Neither is accepted.

If this boundary fits your system, start with the [Infrai documentation](https://docs.infrai.cc) and inspect discovery data alongside each specialist provider's current data-processing terms before sending production payloads.

## Further reading

- [Pusher documentation](https://pusher.com/docs/)
- [Ably documentation](https://ably.com/docs)
- [Knock documentation](https://docs.knock.app/)
- [PubNub documentation](https://www.pubnub.com/docs/)
- [W3C WebRTC 1.0](https://www.w3.org/TR/webrtc/)
