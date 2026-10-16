import { expect, test } from "@playwright/test"
import { createUser, db, PASSWORD, resetLink, uniqueEmail, verificationLink } from "./helpers"

test("a new user signs up, can't move money until they verify their email, then can", async ({ page }) => {
  const email = uniqueEmail("ada")
  await page.goto("/signup")
  await page.getByLabel("Name").fill("Ada Obi")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByLabel("Confirm password").fill(PASSWORD)
  await page.getByRole("button", { name: "Create account" }).click()

  // The banner across the app (the welcome toast repeats its first line, so find it by its button)
  const banner = page.getByRole("status").filter({ has: page.getByRole("button", { name: "Resend link" }) })
  await expect(banner).toContainText("Verify your email to start moving money.")
  await page.goto("/settings")
  await expect(page.getByText("Verify your email to start adding, sending and withdrawing money.")).toBeVisible()

  // Follow the link from the email
  const { id } = await db.user.findUniqueOrThrow({ where: { email } })
  await page.goto(await verificationLink(id))
  await expect(page.getByText("Email verified")).toBeVisible()
  await page.getByRole("link", { name: "Go to your wallet" }).click()
  await expect(page.getByRole("button", { name: "Resend link" })).toBeHidden()
})

test("forgot password: the reset link sets a new password, and only the new one works", async ({ page }) => {
  const user = await createUser("Bola Ade")

  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill(user.email)
  await page.getByRole("button", { name: "Send reset link" }).click()
  await expect(page.getByText(`If an account exists for ${user.email}`)).toBeVisible()

  await page.goto(await resetLink(user.id))
  await page.getByLabel("New password", { exact: true }).fill("BrandNewPass456")
  await page.getByLabel("Confirm new password").fill("BrandNewPass456")
  await page.getByRole("button", { name: "Reset password" }).click()
  await expect(page).toHaveURL(/\/login/)

  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Log in" }).click()
  await expect(page.getByText("Invalid credentials")).toBeVisible()

  await page.getByLabel("Password").fill("BrandNewPass456")
  await page.getByRole("button", { name: "Log in" }).click()
  await expect(page).toHaveURL(/\/$/)
})
