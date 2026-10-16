import { expect, test } from "@playwright/test"
import { api, createUser, PASSWORD, signIn } from "./helpers"

// The only Owner in this run, so solo mode applies: they may approve their own large adjustment
test("an admin adjusts a balance above ₦10,000 and, as the only approver, approves it", async ({ page }) => {
  const owner = await createUser("Owner Admin", { role: "OWNER" })
  const customer = await createUser("Musa Bala")
  await signIn(page, owner, `/admin/users/${customer.id}`)

  await page.getByRole("button", { name: "Adjust balance" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.locator("#adjust-amount").fill("15000")
  await dialog.locator("#adjust-reason").fill("Duplicate card charge refund")
  await dialog.locator("#adjust-password").fill(PASSWORD)
  await dialog.getByRole("button", { name: "Send for approval" }).click()

  await page.goto("/admin/adjustments")
  await expect(page.getByText("You're the only admin who can approve adjustments")).toBeVisible()
  await page.getByRole("button", { name: "Approve" }).first().click()
  const decision = page.getByRole("dialog")
  await decision.locator("#decision-password").fill(PASSWORD)
  await decision.getByRole("button", { name: "Approve my own request" }).click()
  await expect(page.getByText("Approved: the money has moved")).toBeVisible()

  const { balance } = await api<{ balance: string }>("/api/wallet/balance", { token: customer.token })
  expect(Number(balance)).toBe(15_000)

  // The adjustment went through the ledger, so the books still balance
  await page.goto("/admin/reconciliation")
  await expect(page.getByText("The books balance.")).toBeVisible()
})

test("customers can't open the admin area", async ({ page }) => {
  const customer = await createUser("Nneka Ibe")
  await signIn(page, customer, "/admin")
  await expect(page).toHaveURL(/\/$/)
})
