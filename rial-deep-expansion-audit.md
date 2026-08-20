
## Migration concurrency hardening

- The shared PostgreSQL migrator now takes a session-level advisory lock before creating or applying `_migrations` entries. This prevents concurrent deployment runners from executing the same non-idempotent SQL file before the unique migration record rejects one runner.
- JavaScript syntax validation passed. The lock is released on the normal path and is automatically released by PostgreSQL when a failed process connection closes.
