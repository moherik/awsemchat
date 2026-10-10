import assert from "node:assert/strict";
import test from "node:test";
import {
  createDemoBackup,
  getDemoSnapshot,
  restoreDemoBackup,
  updateDemo,
} from "../src/features/demo-store.ts";

test("restoring a backup recovers conversations, moments, and chat settings from that snapshot", () => {
  updateDemo({
    messages: { naya: [{ text: "Saved message", own: true }] },
    moments: { naya: ["Saved moment"] },
    pingMute: { naya: true },
  });
  createDemoBackup();
  updateDemo({
    messages: { naya: [{ text: "After backup", own: true }] },
    moments: { naya: [] },
    pingMute: { naya: false },
  });
  assert.equal(restoreDemoBackup(), true);
  assert.equal(getDemoSnapshot().messages.naya[0].text, "Saved message");
  assert.deepEqual(getDemoSnapshot().moments.naya, ["Saved moment"]);
  assert.equal(getDemoSnapshot().pingMute.naya, true);
});
