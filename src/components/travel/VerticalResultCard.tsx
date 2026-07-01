import { ExternalLink, Star } from "lucide-react";
import type { TravelOffer } from "../../lib/travelApi";

const VERTICAL_LABELS: Record<TravelOffer["vertical"], string> = {
  hotel: "Hotel",
  flight: "Flight",
  activity: "Activity",
  restaurant: "Restaurant",
};

interface VerticalResultCardProps {
  offer: TravelOffer;
  onGetQuote?: (offerId: string) => void;
  quoting?: boolean;
}

export default function VerticalResultCard({ offer, onGetQuote, quoting }: VerticalResultCardProps) {
  return (
    <article className="travel-offer-card">
      <div className="travel-offer-header">
        <span className={`travel-vertical-badge travel-vertical-${offer.vertical}`}>
          {VERTICAL_LABELS[offer.vertical]}
        </span>
        {offer.rating ? (
          <span className="travel-rating">
            <Star size={14} />
            {offer.rating.toFixed(1)}
          </span>
        ) : null}
      </div>
      <h3>{offer.title}</h3>
      <p className="travel-offer-meta">
        {offer.location.city}
        {offer.metadata?.duration ? ` · ${String(offer.metadata.duration)}` : ""}
        {offer.metadata?.cuisine ? ` · ${String(offer.metadata.cuisine)}` : ""}
      </p>
      <div className="travel-offer-footer">
        <strong>{offer.price.display}</strong>
        <div className="travel-offer-actions">
          {onGetQuote && offer.vertical !== "restaurant" ? (
            <button type="button" className="secondary-action" disabled={quoting} onClick={() => onGetQuote(offer.offer_id)}>
              {quoting ? "Quoting…" : "Get quote"}
            </button>
          ) : null}
          <a href={offer.affiliate_url} target="_blank" rel="noopener noreferrer" className="travel-affiliate-cta">
            Book on {offer.provider === "demo" ? "provider" : offer.provider}
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </article>
  );
}
