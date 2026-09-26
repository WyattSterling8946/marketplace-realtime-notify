import assert from "node:assert/strict";
import { handoffBody } from "./order_handoff.js";

const parsed = handoffBody.parse({ order_id: "ord_1", seller_id: "seller_1", buyer_id: "buyer_1", asset_id: "asset_1" });
assert.equal(parsed.order_id, "ord_1");
assert.throws(() => handoffBody.parse({ order_id: "", seller_id: "seller_1", buyer_id: "buyer_1", asset_id: "asset_1" }));
console.log("handoff input validation: pass");
