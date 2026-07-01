import { mintConfirmationToken, verifyConfirmationToken, clearUsedTokensForTests } from "../server/travel/confirmation-tokens.mjs";
import { clearStoresForTests } from "../server/travel/orchestrator.mjs";
import { executeTravelTool } from "../server/travel/tool-executor.mjs";

const env = { TRAVEL_CONFIRM_SECRET: "test-secret", TRAVEL_BOOKING_ENABLED: "0" };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

clearUsedTokensForTests();
clearStoresForTests();

const { confirmation_token, quote_id } = mintConfirmationToken("quote_test_1", env);
const valid = verifyConfirmationToken(quote_id, confirmation_token, env);
assert(valid.ok, "token should verify");

const replay = verifyConfirmationToken(quote_id, confirmation_token, env);
assert(!replay.ok, "token should be single-use");

const bad = verifyConfirmationToken("other_quote", confirmation_token, env);
assert(!bad.ok, "quote mismatch should fail");

const search = await executeTravelTool(
  "search_hotels",
  { location: "Lisbon", check_in: "2026-06-10", check_out: "2026-06-13", guests: 2 },
  env,
);
assert(search.ok && search.result.offers.length > 0, "search_hotels returns demo offers");

const noToken = await executeTravelTool(
  "confirm_booking",
  { quote_id: "quote_x", confirmation_token: "fake" },
  env,
);
assert(!noToken.result.booking.ok, "confirm_booking rejects bad token");

console.log("travel tests passed");
