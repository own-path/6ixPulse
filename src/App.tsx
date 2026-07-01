import { useState } from "react";
import { Home, Plane } from "lucide-react";
import HousingApp from "./modes/HousingApp";
import TravelApp from "./modes/TravelApp";

export type ProductMode = "housing" | "travel";

export default function App() {
  const [productMode, setProductMode] = useState<ProductMode>("housing");

  return (
    <div className="meridian-shell">
      <nav className="product-switcher glass-panel" aria-label="Product mode">
        <button
          type="button"
          className={productMode === "housing" ? "active" : ""}
          onClick={() => setProductMode("housing")}
        >
          <Home size={16} />
          Housing
        </button>
        <button
          type="button"
          className={productMode === "travel" ? "active" : ""}
          onClick={() => setProductMode("travel")}
        >
          <Plane size={16} />
          Travel
        </button>
      </nav>
      {productMode === "housing" ? <HousingApp /> : <TravelApp />}
    </div>
  );
}
