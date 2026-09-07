// Server-side source of truth for everything purchasable — amounts are
// never trusted from the client, only looked up by key here.

export type SubscriptionItem = "monthly" | "annual" | "founding";
export type MerchItem = "tote" | "tee" | "sweatshirt";

export const SUBSCRIPTION_CATALOG: Record<SubscriptionItem, {
  name: string;
  amount: number; // cents
  interval: "month" | "year";
}> = {
  monthly: { name: "Sunland Tribune Monthly Membership", amount: 800, interval: "month" },
  annual: { name: "Sunland Tribune Annual Membership", amount: 4800, interval: "year" },
  founding: { name: "Sunland Tribune Founding Membership", amount: 10000, interval: "year" },
};

export const MERCH_CATALOG: Record<MerchItem, {
  name: string;
  amount: number; // cents
}> = {
  tote: { name: "Sunland Tribune Tote", amount: 3000 },
  tee: { name: "Sunland Tribune Tee", amount: 2500 },
  sweatshirt: { name: "Sunland Tribune Sweatshirt", amount: 3500 },
};
