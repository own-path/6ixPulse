import { useState } from "react";
import { Check, ExternalLink, LoaderCircle } from "lucide-react";
import { mintConfirmToken } from "../../lib/travelApi";

interface ConfirmCardProps {
  quoteId: string;
  affiliateUrl: string;
  onConfirmed?: (quoteId: string, token: string) => void;
}

export default function ConfirmCard({ quoteId, affiliateUrl, onConfirmed }: ConfirmCardProps) {
  const [status, setStatus] = useState<"idle" | "minting" | "confirmed" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const handleConfirm = async () => {
    setStatus("minting");
    setMessage(null);
    const token = await mintConfirmToken(quoteId);
    if (!token) {
      setStatus("error");
      setMessage("Could not mint confirmation token. Try again.");
      return;
    }
    setStatus("confirmed");
    setMessage("Confirmation token issued. Completing booking…");
    onConfirmed?.(quoteId, token);
  };

  return (
    <div className="travel-confirm-card">
      <button type="button" className="travel-confirm-btn" disabled={status === "minting" || status === "confirmed"} onClick={handleConfirm}>
        {status === "minting" ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
        Confirm &amp; book
      </button>
      <a href={affiliateUrl} target="_blank" rel="noopener noreferrer" className="travel-affiliate-link">
        Or book on provider site
        <ExternalLink size={14} />
      </a>
      {message ? <p className="travel-confirm-message">{message}</p> : null}
      {status === "error" ? <p className="travel-confirm-error">{message}</p> : null}
    </div>
  );
}
