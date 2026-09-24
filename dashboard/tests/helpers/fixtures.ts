import type { FakeOdooData } from "./fake-odoo";

/** Shaped exactly like the attendance app's Firebase data (teams.html → bfaTeamsState). */
export function bfaRaw() {
  return {
    branches: [
      { id: "br1", name: "Furn El Chebbek" },
      { id: "br2", name: "Hazmieh" },
    ],
    teams: {
      t1: { id: "t1", branchId: "br1", name: "U14 Boys", coach: "Karim Haddad", assistant: "Rami Khoury" },
      t2: { id: "t2", branchId: "br2", name: "U10", coach: "Maya Saad", assistant: "" },
    },
    players: {
      p1: { id: "p1", branchId: "br1", teamId: "t1", name: "John Smith", months: {} },
      p2: { id: "p2", branchId: "br1", teamId: "t1", name: "Elie Nassar", months: {} },
      p3: { id: "p3", branchId: "br2", teamId: "t2", name: "Georges Abi Raad", months: {} },
      p4: { id: "p4", branchId: "br2", teamId: "t2", name: "Nour Fares", months: {} },
    },
    attendance: {
      "2026-09-01": { p1: "present", p2: "absent", p3: "present", p4: "present" },
      "2026-09-03": { p1: "present", p2: "absent", p3: "absent" },
      "2026-09-05": { p1: "absent", p2: "absent", p4: "present", ghost: "present" },
    },
    staffAttendance: {
      "2026-09-01": { t1: { coach: { status: "present", replacement: "" }, assistant: { status: "absent", replacement: "Tony" } } },
      "2026-09-03": { t1: { coach: { status: "present", replacement: "" } }, t2: { coach: { status: "absent", replacement: "Rami Khoury" } } },
    },
  };
}

export function odooData(): FakeOdooData {
  return {
    "res.company": [{ id: 1, name: "BFA", currency_id: [2, "USD"] }],
    "res.partner": [
      { id: 10, name: "John Smith", email: "john@example.com", phone: "+961 3 111 222", mobile: false, ref: false, parent_id: false, is_company: false, active: true, write_date: "2026-09-01 10:00:00" },
      { id: 11, name: "Nassar Elie", email: false, phone: false, mobile: false, ref: false, parent_id: false, is_company: false, active: true, write_date: "2026-09-01 10:00:00" },
      { id: 12, name: "Parent of Georges", email: false, phone: false, mobile: false, ref: "p3", parent_id: false, is_company: false, active: true, write_date: "2026-09-01 10:00:00" },
      { id: 13, name: "Unrelated Company", email: false, phone: false, mobile: false, ref: false, parent_id: false, is_company: true, active: true, write_date: "2026-09-01 10:00:00" },
    ],
    "account.move": [
      inv(100, "INV/2026/0001", 10, "paid", 150, 0, "2026-08-01", "2026-08-15"),
      inv(101, "INV/2026/0002", 10, "partial", 300, 150, "2026-09-01", "2026-09-10"),
      inv(102, "INV/2026/0003", 11, "not_paid", 200, 200, "2026-09-01", "2099-12-31"),
      inv(103, "INV/2026/0004", 12, "not_paid", 120, 120, "2026-07-01", "2026-07-15"),
      inv(104, "INV/2026/0005", 13, "not_paid", 999, 999, "2026-09-01", "2026-09-30"),
    ],
    "account.payment": [
      { id: 500, name: "PBNK1/2026/0001", date: "2026-08-10", amount: 150, currency_id: [2, "USD"], state: "paid", payment_type: "inbound", partner_type: "customer", partner_id: [10, "John Smith"], reconciled_invoice_ids: [100], memo: "INV/2026/0001", write_date: "2026-08-10 09:00:00" },
      { id: 501, name: "PBNK1/2026/0002", date: "2026-09-05", amount: 150, currency_id: [2, "USD"], state: "paid", payment_type: "inbound", partner_type: "customer", partner_id: [10, "John Smith"], reconciled_invoice_ids: [101], memo: false, write_date: "2026-09-05 09:00:00" },
    ],
  };
}

export function inv(id: number, name: string, partner: number, paymentState: string, total: number, residual: number, date: string, due: string) {
  return {
    id, name, move_type: "out_invoice", state: "posted", payment_state: paymentState, invoice_date: date, invoice_date_due: due,
    partner_id: [partner, `Partner ${partner}`], currency_id: [2, "USD"], amount_untaxed: total, amount_total: total,
    amount_residual: residual, amount_total_signed: total, amount_residual_signed: residual, ref: false, invoice_origin: false,
    write_date: `${date} 12:00:00`,
  };
}
