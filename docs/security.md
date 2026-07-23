# Security Architecture — ﷼ Platform

## 1. Threat model (OWASP Top 10 + crypto-specific)

| # | Threat                          | Mitigation                                                                                   |
|---|---------------------------------|----------------------------------------------------------------------------------------------|
| 1 | Broken access control           | RBAC in every service, gateway-enforced JWT, scoped tokens, no direct DB cross-tenant reads |
| 2 | Cryptographic failures          | Argon2id passwords, AES-GCM field encryption, TLS 1.3 in transit, KMS-managed keys          |
| 3 | Injection (SQL/NoSQL/CMD)       | Parameterized queries, ORM with whitelisted operators, no string-built SQL                    |
| 4 | Insecure design                 | Threat models per service, ADRs reviewed quarterly, defense-in-depth                          |
| 5 | Security misconfig              | Hardened Dockerfiles (distroless/nonroot), CIS-bench scans, read-only FS where possible     |
| 6 | Vulnerable components           | Renovate + Dependabot, Trivy in CI, signed images (cosign)                                   |
| 7 | Auth & session failures         | Short JWT (15m), refresh rotation, device binding, passkeys, TOTP                            |
| 8 | Software & data integrity       | Hash-chained audit log, signed webhooks, image signing, in-toto attestations                 |
| 9 | Logging & monitoring failures   | Centralized logs (Loki), trace IDs everywhere, alert rules                                   |
| 10| SSRF                            | Outbound proxy with allowlist, no user-controlled URLs in fetcher                           |

Crypto-specific:
- Private keys **never** leave HSM/KMS; signing happens via RPC.
- Withdrawals require multi-sig (configurable threshold).
- Hot-wallet balance capped; excess auto-sweeps to cold storage.
- Every on-chain action is replay-protected via nonce + chainId.

## 2. Identity & Access

- Auth: email, phone, OAuth (Google/GitHub/Telegram/Discord), wallet (SIWE/SIWS), passkeys (WebAuthn).
- 2FA: TOTP, FIDO2 hardware keys, SMS (last-resort).
- Sessions: opaque server-side IDs, JWT access (15m), refresh (30d, rotated on use), bound to device fingerprint.
- RBAC: roles, scopes (global/tenant), permissions (resource:action).
- Emergency pause: per-market, per-user, per-scope; signed, auditable, time-boxed.

## 3. Wallets & custody

- Hot wallet: dedicated service, balance cap, KMS-managed key.
- Cold wallet: air-gapped signer, reachable only via multi-sig proposal.
- Treasury: multi-sig with configurable threshold (default 3-of-5).
- Recovery: social + cryptographic; Shamir shares for institutional users.

## 4. Network

- mTLS between services (Istio or Linkerd in prod).
- WAF at edge (Nginx + Cloudflare).
- Rate limit: per-IP, per-user, per-route. DDoS provider configurable.
- Egress allowlist; SSRF-safe HTTP client.

## 5. Data

- Encryption at rest (PG TDE, MinIO SSE-KMS, field-level AES-GCM for PII).
- Backups encrypted client-side (AES-256-GCM), uploaded to S3 with object lock.
- PII minimization — KYC data lives in a dedicated, separately-encrypted schema.

## 6. Application

- CSRF: double-submit cookie + same-site strict.
- CSP: strict, no `unsafe-inline` in prod.
- Input validation: zod (TS) / validator (Go) / serde (Rust).
- Output encoding by default; templating engines auto-escape.
- File upload: type sniff, AV scan, size limits, sandboxed rendering.

## 7. Operations

- Secrets in HashiCorp Vault / cloud KMS — never in env files in prod.
- Audit log: hash-chained, replicated cross-region.
- Bug bounty program scope documented in `docs/bounty.md`.
- Incident response runbook in `docs/runbooks/incident.md`.
- Quarterly red-team exercises, annual third-party pentest.

## 8. Compliance hooks

- KYC/AML: pluggable provider (Sumsub/Onfido/Jumio) behind `kyc-service` interface.
- Travel rule: every cross-border transfer includes originator & beneficiary.
- Sanctions screening: every deposit/withdrawal hits an OFAC/EU/UN list.
- Reporting: SAR/STR generation; jurisdictions configurable.
