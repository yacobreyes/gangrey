// Server-side source of truth for everything purchasable — amounts are
// never trusted from the client, only looked up by key here.

export type SubscriptionItem = "monthly" | "annual" | "founding";
export type MerchItem = "tote" | "tee" | "sweatshirt";

export const SUBSCRIPTION_CATALOG: Record<SubscriptionItem, {
  name: string;
  amount: number; // cents
  interval: "month" | "year";
}> = {
  monthly: { name: "Gangrey Monthly Membership", amount: 800, interval: "month" },
  annual: { name: "Gangrey Annual Membership", amount: 4800, interval: "year" },
  founding: { name: "Gangrey Founding Membership", amount: 10000, interval: "year" },
};

export const MERCH_CATALOG: Record<MerchItem, {
  name: string;
  amount: number; // cents
}> = {
  tote: { name: "Gangrey Tote", amount: 3000 },
  tee: { name: "Gangrey Tee", amount: 2500 },
  sweatshirt: { name: "Gangrey Sweatshirt", amount: 3500 },
};
