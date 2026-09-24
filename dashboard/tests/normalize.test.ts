import { describe, expect, it } from "vitest";
import { categoryFromTeamName, nameSimilarity, normalizeName, normalizePhone } from "@/lib/matching/normalize";

describe("normalisation", () => {
  it("normalises names", () => {
    expect(normalizeName("  Élie   NASSAR (U14) ")).toBe("elie nassar");
    expect(normalizeName("Jean-Paul O'Neil")).toBe("jean paul o neil");
  });
  it("normalises Lebanese phone numbers", () => {
    expect(normalizePhone("+961 3 123 456")).toBe("3123456");
    expect(normalizePhone("00961-3-123456")).toBe("3123456");
    expect(normalizePhone("03/123456")).toBe("3123456");
    expect(normalizePhone("123")).toBeNull();
  });
  it("derives team categories", () => {
    expect(categoryFromTeamName("U14 Boys")).toBe("U14");
    expect(categoryFromTeamName("Under-10 A")).toBe("U10");
    expect(categoryFromTeamName("Seniors")).toBeNull();
  });
  it("scores name similarity independent of order", () => {
    expect(nameSimilarity("John Smith", "Smith John")).toBeGreaterThan(0.95);
    expect(nameSimilarity("Georges Abi Raad", "George Abi-Raad")).toBeGreaterThan(0.85);
    expect(nameSimilarity("John Smith", "Maya Saad")).toBeLessThan(0.6);
    expect(nameSimilarity("Smith", "John Smith")).toBeLessThan(0.85);
  });
});
