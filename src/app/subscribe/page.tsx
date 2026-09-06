import { Fragment } from "react";
import type { Metadata } from "next";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import CheckoutButton from "@/components/CheckoutButton";
import SubscribeButton from "@/components/SubscribeButton";
import type { SubscriptionItem } from "@/lib/checkoutCatalog";
import { listFoundingMemberNames } from "@/lib/membership";

// Founding members read from the live member list on every request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Tampa Tribune | Subscribe",
  description: "Become a free or paid member of The Tampa Tribune, a literary magazine.",
  alternates: { canonical: "/subscribe" },
};

const PAID_TIERS: { key: SubscriptionItem; name: string; price: string; per: string; desc: string }[] = [
  {
    key: "monthly",
    name: "Monthly Member",
    price: "$8",
    per: "/mo",
    desc: "Get three issues a year, full access to the archive while subscribed, and discounted tickets to workshops with guest editors and contributors.",
  },
  {
    key: "annual",
    name: "Annual Member",
    price: "$48",
    per: "/yr",
    desc: "Get three issues a year, full access to the archive, a limited-edition bookmark, and discounted tickets to workshops with guest editors and contributors.",
  },
  {
    key: "founding",
    name: "Founding Member",
    price: "$100",
    per: "/yr",
    desc: "Everything in Annual, plus a Tampa Tribune tote, early access to the first issue, and your name on the founding members page.",
  },
];

export default async function SubscribePage() {
  // Founding members, in the order they joined. Names come from Stripe
  // checkout; the section keeps its placeholder until the first one lands.
  let foundingNames: string[] = [];
  try { foundingNames = await listFoundingMemberNames(); } catch {}

  return (
    <div className="subscribe-page">
      <style>{`
        .subscribe-page { min-height: 100vh; display: flex; flex-direction: column; background: #ffffff; color: #000000; }
        .subscribe-main { flex: 1; width: 100%; max-width: 1290px; margin: 0 auto; padding: 20px 32px 42px; box-sizing: border-box; }
        .subscribe-header { border-bottom: 1px solid #000000; padding-bottom: 16px; margin-bottom: 32px; }
        .subscribe-h1 {
          margin: 0;
          font-family: var(--font-headline);
          font-size: clamp(30px, 4.2vw, 40px);
          line-height: 1.02; letter-spacing: -.03em; font-weight: 800;
        }
        .subscribe-dek {
          margin: 14px 0 0;
          font-family: var(--font-body);
          font-size: clamp(18px, 2.4vw, 22px);
          line-height: 1.4; color: #000000; max-width: 640px;
        }
        .tiers-grid {
          display: grid;
          grid-template-columns: 1fr 1px 1fr 1px 1fr 1px 1fr;
          column-gap: 32px;
        }
        .tier { display: flex; flex-direction: column; height: 100%; }
        .tier-divider { border-left: 1px dotted #8a8a8c; }
        .tier-name {
          margin: 0 0 6px;
          font-family: var(--font-headline);
          font-size: 23px; font-weight: 800; letter-spacing: -.02em;
        }
        .tier-price {
          font-family: var(--font-headline);
          font-weight: 800; font-size: 28px; letter-spacing: -.02em;
          color: #490000; margin-bottom: 18px;
        }
        .tier-price .per { font-size: 13px; font-weight: 700; letter-spacing: .05em; }
        .tier-desc {
          margin: 0 0 22px;
          font-family: var(--font-body);
          font-size: 15.5px; line-height: 1.55; color: #392a22;
        }
        .tier-join {
          margin-top: auto;
          align-self: flex-start;
          background: none; border: 0; padding: 0; cursor: pointer;
          color: #490000;
          font-family: var(--font-subhead);
          font-weight: 700; font-size: 11px; letter-spacing: .16em; text-transform: uppercase;
          text-decoration: none;
          text-align: left;
        }
        .founding {
          margin-top: 60px;
          border-top: 3px solid #000000;
          padding-top: 24px;
          text-align: center;
        }
        .founding h2 {
          margin: 0 0 22px;
          font-family: var(--font-headline);
          font-size: 26px; font-weight: 800; letter-spacing: -.02em;
        }
        .founding-placeholder {
          margin: 0;
          font-family: var(--font-body);
          font-size: 17px; font-style: italic; color: #392a22;
        }
        .founding-names {
          margin: 0; padding: 0; list-style: none;
          display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 26px;
        }
        .founding-names li {
          font-family: var(--font-headline);
          font-size: 19px; font-weight: 700; color: #000000;
        }
        @media (max-width: 900px) {
          .subscribe-main { padding: 20px 20px 48px; }
          .tiers-grid { grid-template-columns: 1fr 1fr; gap: 28px 20px; }
          .tier-divider { display: none; }
          .tier-name { font-size: 18px; margin-bottom: 4px; }
          .tier-price { font-size: 21px; margin-bottom: 12px; }
          .tier-desc { font-size: 13px; margin-bottom: 16px; }
          .tier-join { font-size: 10px; }
          .founding { margin-top: 40px; padding-top: 18px; }
          .founding h2 { font-size: 20px; margin-bottom: 16px; }
          .founding-placeholder { font-size: 14px; }
        }
        @media (max-width: 520px) {
          .tiers-grid { grid-template-columns: 1fr; }
        }
      `}</style>
      <MagHeader />
      <main className="subscribe-main">
        <div className="subscribe-header">
          <h1 className="subscribe-h1">Subscribe</h1>
          <p className="subscribe-dek">To receive new issues and support the work, consider becoming a free or paid member.</p>
        </div>

        <div className="tiers-grid">
          <div className="tier">
            <h2 className="tier-name">Free Reader</h2>
            <div className="tier-price">$0</div>
            <p className="tier-desc">Get announcements, select posts, calls for submissions, and our monthly Tampa Tribune Classics newsletter.</p>
            <SubscribeButton className="tier-join">Join →</SubscribeButton>
          </div>
          {PAID_TIERS.map(tier => (
            <Fragment key={tier.name}>
              <div className="tier-divider" />
              <div className="tier">
                <h2 className="tier-name">{tier.name}</h2>
                <div className="tier-price">{tier.price}<span className="per">{tier.per}</span></div>
                <p className="tier-desc">{tier.desc}</p>
                <CheckoutButton kind="subscription" item={tier.key} className="tier-join">Join →</CheckoutButton>
              </div>
            </Fragment>
          ))}
        </div>

        <div className="founding">
          <h2>Our Founding Members</h2>
          {foundingNames.length === 0
            ? <p className="founding-placeholder">Founding members will be recognized here.</p>
            : <ul className="founding-names">{foundingNames.map(n => <li key={n}>{n}</li>)}</ul>}
        </div>
      </main>
      <MagFooter />
    </div>
  );
}
