# Native reporting: TDD plan

1. Test report request validation and exact retry semantics; implement a bounded authenticated API client.
2. Test server input validation, accepted-friend/conversation access, selected-event access, redaction refusal, idempotency, and 90-day expiry. Implement PostgreSQL persistence, migration, and cleanup worker.
3. Add native report screen for a private conversation: load authenticated local history, select text excerpts, show reason/details/review and disclosure/retention, submit once, preserve draft on failure. Route the existing report entry point to it.
4. Verify mobile behavior/UI suites, Go tests/race/vet as configured, TypeScript, Expo lint/export, migration readiness and Android debug assembly. Do not claim device acceptance; emulator interaction is skipped by owner direction.
