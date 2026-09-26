import { z } from "zod";
import { InfraiRealtime } from "./infrai_realtime.js";

export const handoffBody = z.object({ order_id: z.string().min(1), seller_id: z.string().min(1), buyer_id: z.string().min(1), asset_id: z.string().min(1) });
export type OrderHandoff = z.infer<typeof handoffBody>;

export async function notifyOrderHandoff(input: unknown, client = new InfraiRealtime(process.env.INFRAI_API_KEY ?? "")) {
  const order = handoffBody.parse(input);
  const channel = `order:${order.order_id}`;
  await client.channelCreate(channel);
  await client.publish(channel, "order.handoff", { order_id: order.order_id, seller_id: order.seller_id, buyer_id: order.buyer_id, asset_id: order.asset_id, state: "ready_for_buyer" }, order.seller_id);
  return { channel, state: "ready_for_buyer" as const };
}

if (process.argv[1]?.endsWith("order_handoff.ts")) {
  const sample = { order_id: "ord_1042", seller_id: "seller_7", buyer_id: "buyer_9", asset_id: "asset_3" };
  notifyOrderHandoff(sample).then(console.log).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
