import bcrypt from "bcryptjs";

const COST = 12;
// Used to spend the same time on unknown e-mail addresses as on real ones,
// so login timing does not reveal which accounts exist.
const DUMMY_HASH = "$2b$12$OvgEmmJyzywpKPVEQbLq7u7JorNaUS1Z6sLM30V3StZuVwUWryhh2";

export const PASSWORD_MIN_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, hash);
}

export function passwordProblems(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > 200) return "Password is too long.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Password must contain letters and numbers.";
  return null;
}
