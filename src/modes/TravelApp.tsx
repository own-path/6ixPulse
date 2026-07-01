import { useState } from "react";
import { Plane, SendHorizontal, Sparkles } from "lucide-react";
import TravelThread from "../components/travel/TravelThread";
import { getTravelQuote, runTravelBackend, type TravelMessage, type TravelOffer, type TravelQuote } from "../lib/travelApi";

const SUGGESTED_PROMPTS = [
  { label: "3 days in Lisbon", prompt: "Plan 3 days in Lisbon in June — hotels, activities, and restaurants." },
  { label: "Toronto → Lisbon flights", prompt: "Find round-trip flights from Toronto (YYZ) to Lisbon (LIS) June 10–17 for 2 passengers." },
  { label: "Hotels under $200", prompt: "Search hotels in Lisbon June 10–13 for 2 guests under $200 per night." },
];

export default function TravelApp() {
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<TravelMessage[]>([]);
  const [offers, setOffers] = useState<TravelOffer[]>([]);
  const [quotes, setQuotes] = useState<TravelQuote[]>([]);
  const [quotingId, setQuotingId] = useState<string | null>(null);

  const runSearch = async (text: string, confirmOpts?: { quote_id: string; confirmation_token: string }) => {
    const ask = text.trim();
    if (!ask && !confirmOpts) return;

    setRunning(true);
    if (ask) {
      setMessages((prev) => [...prev, { role: "user", content: ask }]);
      setPrompt("");
    }

    const result = await runTravelBackend(ask || "Complete the booking.", confirmOpts);
    setRunning(false);

    if (!result?.ok) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result?.message || "Travel search failed. Check API keys and try again.",
        },
      ]);
      return;
    }

    if (result.summary) {
      setMessages((prev) => [...prev, { role: "assistant", content: result.summary! }]);
    }
    if (result.offers?.length) {
      setOffers((prev) => {
        const map = new Map(prev.map((o) => [o.offer_id, o]));
        for (const offer of result.offers!) map.set(offer.offer_id, offer);
        return [...map.values()];
      });
    }
    if (result.quotes?.length) {
      setQuotes((prev) => {
        const map = new Map(prev.map((q) => [q.quote_id, q]));
        for (const quote of result.quotes!) map.set(quote.quote_id, quote);
        return [...map.values()];
      });
    }
  };

  const handleGetQuote = async (offerId: string) => {
    setQuotingId(offerId);
    const quote = await getTravelQuote(offerId);
    setQuotingId(null);
    if (quote) {
      setQuotes((prev) => {
        const map = new Map(prev.map((q) => [q.quote_id, q]));
        map.set(quote.quote_id, quote);
        return [...map.values()];
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Quote ready for ${quote.title}: ${quote.total.display}. Tap Confirm & book when ready.` },
      ]);
    }
  };

  const handleConfirmed = (quoteId: string, token: string) => {
    runSearch("", { quote_id: quoteId, confirmation_token: token });
  };

  return (
    <div className="travel-app">
      <header className="travel-header glass-panel">
        <div className="travel-brand">
          <Plane size={20} />
          <div>
            <h1>Meridian Travel</h1>
            <p>Discovery-first travel agent — search everything, book with explicit confirmation.</p>
          </div>
        </div>
      </header>

      <main className="travel-main">
        <TravelThread
          messages={messages}
          offers={offers}
          quotes={quotes}
          running={running}
          quotingId={quotingId}
          onGetQuote={handleGetQuote}
          onConfirmed={handleConfirmed}
        />
      </main>

      <footer className="travel-composer glass-panel">
        <div className="travel-chips">
          {SUGGESTED_PROMPTS.map((chip) => (
            <button key={chip.label} type="button" onClick={() => runSearch(chip.prompt)} disabled={running}>
              <Sparkles size={14} />
              {chip.label}
            </button>
          ))}
        </div>
        <div className="travel-composer-row">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask about hotels, flights, activities, or restaurants…"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                runSearch(prompt);
              }
            }}
          />
          <button type="button" className="travel-send" disabled={running || !prompt.trim()} onClick={() => runSearch(prompt)}>
            <SendHorizontal size={18} />
          </button>
        </div>
      </footer>
    </div>
  );
}
