import { describe, expect, it } from "vitest";
import { findCandidates, type MatchCustomer, type MatchPlayer } from "@/lib/matching/engine";

const p = (id: number, name: string, extra: Partial<MatchPlayer> = {}): MatchPlayer => ({
  id, externalId: `p${id}`, name, normalizedName: name.toLowerCase(), email: null, phone: null, ...extra,
});
const c = (id: number, name: string, extra: Partial<MatchCustomer> = {}): MatchCustomer => ({
  id, name, normalizedName: name.toLowerCase(), email: null, phone: null, mobile: null, reference: null, ...extra,
});
const opts = { autoConfirmExactNames: true, fuzzyThreshold: 0.72 };

describe("matching", () => {
  it("prefers the player ID stored in Odoo", () => {
    const res = findCandidates([p(1, "Georges Abi Raad")], [c(9, "Parent Account", { reference: "p1" })], opts);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ method: "player_id", certain: true, customerId: 9 });
  });
  it("matches on e-mail and phone", () => {
    const res = findCandidates(
      [p(1, "A B", { email: "X@Mail.com" }), p(2, "C D", { phone: "03 123 456" })],
      [c(7, "Other", { email: "x@mail.com" }), c(8, "Else", { mobile: "+9613123456" })],
      opts,
    );
    expect(res.find((r) => r.playerId === 1)).toMatchObject({ method: "email", certain: true, customerId: 7 });
    expect(res.find((r) => r.playerId === 2)).toMatchObject({ method: "phone", certain: true, customerId: 8 });
  });
  it("does not auto-confirm ambiguous exact names", () => {
    const res = findCandidates([p(1, "john smith"), p(2, "john smith")], [c(7, "john smith")], opts);
    expect(res.every((r) => !r.certain)).toBe(true);
  });
  it("never auto-confirms fuzzy names", () => {
    const res = findCandidates([p(1, "elie nassar")], [c(7, "nassar elie"), c(8, "maya saad")], opts);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ method: "name_fuzzy", certain: false, customerId: 7 });
  });
  it("respects the exact-name auto-confirm setting", () => {
    const res = findCandidates([p(1, "john smith")], [c(7, "john smith")], { ...opts, autoConfirmExactNames: false });
    expect(res[0].certain).toBe(false);
  });
});
