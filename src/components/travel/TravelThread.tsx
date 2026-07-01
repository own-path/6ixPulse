import VerticalResultCard from "./VerticalResultCard";
import QuoteCard from "./QuoteCard";
import type { TravelMessage, TravelOffer, TravelQuote } from "../../lib/travelApi";

interface TravelThreadProps {
  messages: TravelMessage[];
  offers: TravelOffer[];
  quotes: TravelQuote[];
  running?: boolean;
  quotingId?: string | null;
  onGetQuote?: (offerId: string) => void;
  onConfirmed?: (quoteId: string, token: string) => void;
}

const VERTICAL_ORDER: TravelOffer["vertical"][] = ["hotel", "flight", "activity", "restaurant"];

export default function TravelThread({
  messages,
  offers,
  quotes,
  running,
  quotingId,
  onGetQuote,
  onConfirmed,
}: TravelThreadProps) {
  const offersByVertical = VERTICAL_ORDER.map((vertical) => ({
    vertical,
    items: offers.filter((o) => o.vertical === vertical),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="travel-thread">
      {messages.map((message, index) => (
        <div key={`${message.role}-${index}`} className={`travel-message travel-message-${message.role}`}>
          <span className="travel-message-label">{message.role === "user" ? "You" : "Meridian Travel"}</span>
          <p>{message.content}</p>
        </div>
      ))}

      {running ? (
        <div className="travel-message travel-message-assistant">
          <span className="travel-message-label">Meridian Travel</span>
          <p className="travel-running">Searching hotels, flights, activities, and restaurants…</p>
        </div>
      ) : null}

      {offersByVertical.map((group) => (
        <section key={group.vertical} className="travel-offer-group">
          <h2>{group.vertical.charAt(0).toUpperCase() + group.vertical.slice(1)}s</h2>
          <div className="travel-offer-grid">
            {group.items.map((offer) => (
              <VerticalResultCard
                key={offer.offer_id}
                offer={offer}
                onGetQuote={onGetQuote}
                quoting={quotingId === offer.offer_id}
              />
            ))}
          </div>
        </section>
      ))}

      {quotes.length > 0 ? (
        <section className="travel-quote-group">
          <h2>Quotes</h2>
          {quotes.map((quote) => (
            <QuoteCard key={quote.quote_id} quote={quote} onConfirmed={onConfirmed} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
