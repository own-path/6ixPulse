import {
  searchHotels,
  searchFlights,
  searchActivities,
  searchRestaurants,
  createQuote,
  confirmBooking,
} from "./orchestrator.mjs";
import { verifyConfirmationToken } from "./confirmation-tokens.mjs";

export async function executeTravelTool(name, input, env = process.env) {
  const started = Date.now();
  try {
    let result;
    switch (name) {
      case "search_hotels":
        result = { offers: await searchHotels(input, env) };
        break;
      case "search_flights":
        result = { offers: await searchFlights(input, env) };
        break;
      case "search_activities":
        result = { offers: await searchActivities(input, env) };
        break;
      case "search_restaurants":
        result = { offers: await searchRestaurants(input, env) };
        break;
      case "get_quote":
        result = { quote: await createQuote(input, env) };
        break;
      case "confirm_booking":
        result = {
          booking: await confirmBooking(input, (qid, tok) => verifyConfirmationToken(qid, tok, env), env),
        };
        break;
      default:
        return {
          ok: false,
          error: "unknown_tool",
          message: `Unknown tool: ${name}`,
          duration_ms: Date.now() - started,
        };
    }

    if (result?.quote?.error) {
      return {
        ok: false,
        error: result.quote.error,
        message: result.quote.message,
        duration_ms: Date.now() - started,
      };
    }

    return { ok: true, result, duration_ms: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      error: "tool_execution_failed",
      message: error instanceof Error ? error.message : "Unknown error",
      duration_ms: Date.now() - started,
    };
  }
}
