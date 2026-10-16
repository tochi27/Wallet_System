import { SpendingCategory } from "@prisma/client";

export const CATEGORIES = Object.values(SpendingCategory) as SpendingCategory[];

export const CATEGORY_LABELS: Record<SpendingCategory | "UNCATEGORISED", string> = {
  FOOD: "Food & drink",
  BILLS: "Bills & rent",
  TRANSPORT: "Transport",
  SHOPPING: "Shopping",
  ENTERTAINMENT: "Entertainment",
  HEALTH: "Health",
  FAMILY_FRIENDS: "Family & friends",
  SAVINGS: "Savings",
  OTHER: "Other",
  UNCATEGORISED: "Not categorised yet",
};

// Shown to the model so it can tell the categories apart
export const CATEGORY_GUIDE = [
  "FOOD: restaurants, groceries, takeaway, drinks",
  "BILLS: rent, electricity, internet, airtime, data, subscriptions, school fees",
  "TRANSPORT: fuel, ride-hailing, bus, flights, car repairs",
  "SHOPPING: clothes, electronics, online shopping, household items",
  "ENTERTAINMENT: cinema, events, games, betting, outings",
  "HEALTH: pharmacy, hospital, gym, insurance",
  "FAMILY_FRIENDS: money sent to people with no clear purpose, gifts, contributions, splitting bills",
  "SAVINGS: savings, investments, moving money to save",
  "OTHER: anything that fits none of the above",
].join("\n");
