import type { InsightFacts } from "../../../services/insights/facts.service";
import { Pseudonymiser } from "../../../services/insights/pseudonymise";
import { checkContent, factsForModel, naira, templateInsights, usesOnlyAllowedFigures } from "../../../services/insights/writer";

const facts = (overrides: Partial<InsightFacts> = {}): InsightFacts => ({
  timezone: "Africa/Lagos",
  period: { from: "2026-09-15", to: "2026-10-14" },
  previousPeriod: { from: "2026-08-16", to: "2026-09-14" },
  current: { moneyIn: "450000.00", spent: "381000.00", withdrawn: "0.00", spendCount: 17 },
  previous: { moneyIn: "450000.00", spent: "246900.00", withdrawn: "0.00", spendCount: 16 },
  spentChangePercent: 54,
  categories: [
    { category: "FOOD", current: "70000.00", previous: "24000.00", changePercent: 192 },
    { category: "TRANSPORT", current: "10500.00", previous: "22400.00", changePercent: -53 },
  ],
  topRecipients: [{ userId: "u-emeka", name: "Emeka", total: "150000.00", count: 1 }],
  largestSpend: { amount: "150000.00", date: "2026-09-20", category: "BILLS", recipient: "Emeka", recipientId: "u-emeka", description: "Rent to Emeka" },
  regularPayments: [{ userId: "u-emeka", name: "Emeka", typicalAmount: "150000.00", months: 3 }],
  unusualSpends: [],
  uncategorisedCount: 0,
  ...overrides,
});

describe("Pseudonymiser", () => {
  it("gives each person one alias across their ID, name and email, and swaps names back", () => {
    const p = new Pseudonymiser();
    const a = p.alias(["u1", "Grace Hopper", "grace@example.com"], "Grace");
    const b = p.alias("u2", "Tunde");

    expect(a).toBe("Person A");
    expect(b).toBe("Person B");
    expect(p.alias("grace@example.com", "ignored")).toBe("Person A");
    expect(p.scrub("Transfer to grace@example.com for Grace Hopper's party")).toBe("Transfer to Person A for Person A's party");
    expect(p.restore("You paid Person A and Person B")).toBe("You paid Grace and Tunde");
  });

  it("hides email addresses it doesn't know", () => {
    expect(new Pseudonymiser().scrub("Transfer to stranger@mail.com")).toBe("Transfer to someone");
  });

  it("never lets a short alias eat a longer one when restoring", () => {
    const p = new Pseudonymiser();
    for (let i = 0; i < 30; i++) p.alias(`u${i}`, `Name${i}`);
    expect(p.restore("Person 27 and Person B")).toBe("Name26 and Name1");
  });
});

describe("insight writer", () => {
  it("formats naira the way the model is told to copy it", () => {
    expect(naira("12400.00")).toBe("₦12,400");
    expect(naira("1250.5")).toBe("₦1,250.50");
    expect(naira("0")).toBe("₦0");
  });

  it("sends the model pseudonyms and pre-formatted figures only", () => {
    const pseudonyms = new Pseudonymiser();
    const { payload } = factsForModel(facts(), pseudonyms);
    const text = JSON.stringify(payload);

    expect(text).not.toContain("Emeka");
    expect(text).not.toContain("u-emeka");
    expect(text).toContain("Person A");
    expect(payload.largestPayment?.description).toBe("Rent to Person A");
    expect(payload.categories[0]).toMatchObject({ thisPeriod: "₦70,000", change: "up 192%" });
  });

  it.each([
    ["You spent ₦381,000, up 54%.", true],
    ["Food rose to ₦70,000.00.", true],
    ["You spent ₦381,500.", false], // not a figure we calculated
    ["Spending rose 55%.", false],
    ["About ₦400k overall", false], // a rounded figure is still an invented one
  ])("checks figures in %j", (text, ok) => {
    const { allowed } = factsForModel(facts(), new Pseudonymiser());
    expect(usesOnlyAllowedFigures(text, allowed)).toBe(ok);
  });

  it("drops insights with invented figures and restores names", () => {
    const pseudonyms = new Pseudonymiser();
    const { allowed } = factsForModel(facts(), pseudonyms);

    const checked = checkContent(
      {
        headline: "You spent ₦381,000 this month.",
        insights: [
          { kind: "recipient", tone: "neutral", title: "Top recipient", body: "You sent ₦150,000 to Person A." },
          { kind: "tip", tone: "neutral", title: "Savings", body: "You could save ₦12,345 a month." },
        ],
      },
      allowed,
      pseudonyms
    );

    expect(checked?.insights).toHaveLength(1);
    expect(checked?.insights[0].body).toBe("You sent ₦150,000 to Emeka.");
  });

  it("rejects the whole reply when the headline invents a figure", () => {
    const pseudonyms = new Pseudonymiser();
    const { allowed } = factsForModel(facts(), pseudonyms);
    const reply = { headline: "You spent ₦999 this month.", insights: [{ kind: "tip" as const, tone: "neutral" as const, title: "x", body: "Fine." }] };

    expect(checkContent(reply, allowed, pseudonyms)).toBeNull();
  });

  it("writes template insights from the facts alone", () => {
    const content = templateInsights(facts());

    expect(content.headline).toBe("You spent ₦381,000 in the last 30 days, 54% more than the 30 days before.");
    expect(content.insights.map((i) => i.kind)).toEqual(["category", "recipient", "regular"]);
    expect(content.insights[0].body).toBe("You spent ₦70,000 on food & drink, up 192% on the 30 days before.");
  });

  it("says so when there's no activity", () => {
    const quiet = facts({
      current: { moneyIn: "0.00", spent: "0.00", withdrawn: "0.00", spendCount: 0 },
      categories: [],
      topRecipients: [],
      regularPayments: [],
    });
    expect(templateInsights(quiet).headline).toMatch(/Not much has happened/);
  });
});
