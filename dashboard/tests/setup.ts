process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://bfa:bfa_dev_pw@localhost:5432/bfa_test";
process.env.SYNC_SCHEDULER_ENABLED = "false";
