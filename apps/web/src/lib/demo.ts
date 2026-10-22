// The live demo site (VITE_DEMO_MODE=true) offers a shared demo login and warns against uploading
// real IDs. The values must match what `npm run seed:demo -- --showcase` created (DEPLOYMENT.md).
const env = import.meta.env

export const demo = {
  enabled: env.VITE_DEMO_MODE === "true",
  email: env.VITE_DEMO_EMAIL ?? "demo@purplewallet.demo",
  password: env.VITE_DEMO_PASSWORD ?? "Password123",
  pin: env.VITE_DEMO_PIN ?? "2580",
}
