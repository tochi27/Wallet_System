import {
  BusIcon,
  CircleHelpIcon,
  FilmIcon,
  HeartPulseIcon,
  PiggyBankIcon,
  ReceiptIcon,
  ShoppingBagIcon,
  UsersIcon,
  UtensilsIcon,
  type LucideIcon,
} from "lucide-react"

// Mirrors the SpendingCategory enum in apps/api/prisma/schema.prisma
export const SPENDING_CATEGORIES = [
  "FOOD",
  "BILLS",
  "TRANSPORT",
  "SHOPPING",
  "ENTERTAINMENT",
  "HEALTH",
  "FAMILY_FRIENDS",
  "SAVINGS",
  "OTHER",
] as const

export type SpendingCategory = (typeof SPENDING_CATEGORIES)[number]
export type CategoryKey = SpendingCategory | "UNCATEGORISED"

export const CATEGORY_META: Record<CategoryKey, { label: string; icon: LucideIcon }> = {
  FOOD: { label: "Food & drink", icon: UtensilsIcon },
  BILLS: { label: "Bills & rent", icon: ReceiptIcon },
  TRANSPORT: { label: "Transport", icon: BusIcon },
  SHOPPING: { label: "Shopping", icon: ShoppingBagIcon },
  ENTERTAINMENT: { label: "Entertainment", icon: FilmIcon },
  HEALTH: { label: "Health", icon: HeartPulseIcon },
  FAMILY_FRIENDS: { label: "Family & friends", icon: UsersIcon },
  SAVINGS: { label: "Savings", icon: PiggyBankIcon },
  OTHER: { label: "Other", icon: CircleHelpIcon },
  UNCATEGORISED: { label: "Not categorised yet", icon: CircleHelpIcon },
}
