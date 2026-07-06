import type { Metadata } from "next";
import Link from "next/link";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import CheckoutButton from "@/components/CheckoutButton";
import type { MerchItem } from "@/lib/checkoutCatalog";

export const metadata: Metadata = {
  title: "Gangrey | Shop",
  alternates: { canonical: "/store" },
  description: "Merchandise and memberships from Gangrey, a literary magazine.",
};

const PRODUCTS: { key: MerchItem; kicker: string; name: string; price: string }[] = [
  { key: "tote", kicker: "Canvas", name: "Gangrey Tote", price: "$30" },
  { key: "tee", kicker: "Apparel", name: "Gangrey Tee", price: "$25" },
  { key: "sweatshirt", kicker: "Apparel", name: "Gangrey Sweatshirt", price: "$35" },
];

export default function StorePage() {
  return (
    <div className="store-page">
      <style>{`
        .store-page { min-height: 100vh; display: flex; flex-direction: column; background: #ffffff; color: #000000; }
        .store-main { flex: 1; width: 100%; max-width: 1290px; margin: 0 auto; padding: 20px 32px 42px; box-sizing: border-box; }
        .store-header { border-bottom: 1px solid #000000; padding-bottom: 18px; margin-bottom: 34px; }
        .store-h1 {
          margin: 0;
          font-family: var(--font-headline);
          font-size: clamp(30px, 4vw, 36px);
          line-height: 1; letter-spacing: -.03em; font-weight: 800;
        }
        .store-band {
          background: #490000; color: #ffffff;
          padding: 32px 40px;
          display: flex; align-items: center; justify-content: space-between;
          gap: 30px; flex-wrap: wrap;
          margin-bottom: 44px;
        }
        .store-band-title {
          font-family: var(--font-headline);
          font-size: 30px; font-weight: 800; letter-spacing: -.02em; line-height: 1;
          margin-bottom: 0;
        }
        .store-band-desc {
          margin: 0;
          font-family: var(--font-body);
          font-size: 16px; font-style: italic; opacity: .9; max-width: 520px;
          line-height: 1.4;
        }
        .store-join {
          display: flex; align-items: center; gap: 22px; white-space: nowrap;
          color: #ffffff;
          font-family: var(--font-subhead);
          font-weight: 800; font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
          text-decoration: underline; text-underline-offset: 4px;
        }
        /* Spread the fixed-width products across the full section width so they
           reach the same left/right edges as the band and header, with the
           middle card centered between them. */
        .store-grid {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 40px 36px;
        }
        /* Keep each product's text + price/Buy Now row aligned to the image
           width, so "Buy Now" never sticks out past the image's right edge. */
        .store-grid > div { flex: 0 0 240px; max-width: 240px; }
        .product-img {
          display: flex; align-items: center; justify-content: center;
          width: 100%; max-width: 240px; aspect-ratio: 1 / 1;
          background: #f4f4f5;
          box-sizing: border-box;
        }
        .product-img span {
          font-family: var(--font-subhead);
          font-size: 11px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase;
          color: #8a8a8c;
          text-align: center;
          padding: 0 16px;
        }
        .product-kicker {
          margin-top: 14px;
          font-family: var(--font-subhead);
          font-weight: 800; font-size: 10px; letter-spacing: .2em; text-transform: uppercase;
          color: #490000; margin-bottom: 6px;
        }
        .product-name {
          margin: 0 0 4px;
          font-family: var(--font-headline);
          font-size: 22px; line-height: 1.1; letter-spacing: -.02em; font-weight: 800;
        }
        .product-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
        .product-price {
          font-family: var(--font-headline);
          font-weight: 800; font-size: 18px; color: #490000;
        }
        .product-cart {
          color: #490000;
          font-family: var(--font-subhead);
          font-weight: 700; font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase;
          text-decoration: none;
        }
        @media (max-width: 900px) {
          .store-main { padding: 20px 20px 48px; }
          .store-band { padding: 16px 18px; gap: 14px; margin-bottom: 32px; flex-wrap: nowrap; align-items: center; justify-content: space-between; }
          .store-band > div { flex: 1; min-width: 0; }
          .store-band-title { font-size: 17px; margin-bottom: 0; }
          .store-band-desc { font-size: 12px; }
          .store-join { font-size: 10.5px; gap: 0; flex-shrink: 0; }
          .store-grid { gap: 28px 20px; }
          .store-grid > div { flex: 0 0 160px; max-width: 160px; }
          .product-name { font-size: 18px; }
        }
      `}</style>
      <MagHeader />
      <main className="store-main">
        <div className="store-header">
          <h1 className="store-h1">Shop</h1>
        </div>

        <div className="store-band">
          <div>
            <div className="store-band-title">Annual Member — $80/year</div>
          </div>
          <Link href="/subscribe" className="store-join">Join →</Link>
        </div>

        <div className="store-grid">
          {PRODUCTS.map(p => (
            <div key={p.name}>
              <div className="product-img"><span>{p.name}</span></div>
              <div className="product-kicker">{p.kicker}</div>
              <h3 className="product-name">{p.name}</h3>
              <div className="product-foot">
                <span className="product-price">{p.price}</span>
                <CheckoutButton kind="merch" item={p.key} className="product-cart">Buy Now →</CheckoutButton>
              </div>
            </div>
          ))}
        </div>
      </main>
      <MagFooter />
    </div>
  );
}
