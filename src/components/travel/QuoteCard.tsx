import type { TravelQuote } from "../../lib/travelApi";
import ConfirmCard from "./ConfirmCard";

interface QuoteCardProps {
  quote: TravelQuote;
  onConfirmed?: (quoteId: string, token: string) => void;
}

export default function QuoteCard({ quote, onConfirmed }: QuoteCardProps) {
  return (
    <article className="travel-quote-card">
      <div className="travel-quote-header">
        <span className={`travel-vertical-badge travel-vertical-${quote.vertical}`}>Quote</span>
        <span className="travel-quote-expiry">Expires {new Date(quote.expires_at).toLocaleString()}</span>
      </div>
      <h3>{quote.title}</h3>
      <ul className="travel-quote-lines">
        {quote.line_items.map((line) => (
          <li key={line.label}>
            <span>{line.label}</span>
            <span>{line.price.display}</span>
          </li>
        ))}
      </ul>
      <div className="travel-quote-total">
        <span>Total</span>
        <strong>{quote.total.display}</strong>
      </div>
      <ConfirmCard quoteId={quote.quote_id} affiliateUrl={quote.affiliate_url} onConfirmed={onConfirmed} />
    </article>
  );
}
