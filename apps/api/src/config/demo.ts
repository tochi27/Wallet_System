/**
 * Demo accounts for showing the app to people (seeded with `npm run seed:demo -- --showcase`) all
 * use this domain. It can't receive mail, so nothing is ever emailed to them, and their password
 * and PIN can't be changed, so one visitor can't lock everyone else out of the shared login.
 */
export const DEMO_DOMAIN = "purplewallet.demo";

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

export const isDemoEmail = (email: string) => domainOf(email) === DEMO_DOMAIN;

// Reserved for documentation and testing (RFC 2606), plus the demo domain: mail to these can never
// arrive, so sending would only bounce back to the app's own inbox
const UNDELIVERABLE = [DEMO_DOMAIN, "example.com", "example.org", "example.net"];
const UNDELIVERABLE_TLDS = [".test", ".example", ".invalid", ".localhost"];

export const isUndeliverable = (email: string) => {
  const domain = domainOf(email);
  return UNDELIVERABLE.includes(domain) || UNDELIVERABLE_TLDS.some((tld) => domain.endsWith(tld));
};
