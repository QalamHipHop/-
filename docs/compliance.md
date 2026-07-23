# Compliance & Regulatory Hooks

> The platform is engineered for **compliant, regulated operation**. You — the operator — are responsible for all legal/regulatory clearances in your jurisdiction(s).

## Built-in hooks (no assumptions about provider)

| Hook                         | Where                                      |
|------------------------------|--------------------------------------------|
| KYC / identity verification  | `kyc-service` (interface; provider swappable) |
| Sanctions screening (OFAC/EU/UN) | `compliance/screen` (interface)         |
| Travel rule (FATF Rec. 16)  | `compliance/travel-rule`                   |
| SAR / STR generation         | `compliance/reports`                       |
| Tax reporting (1099-DA, EU DAC8, etc.) | `compliance/tax`                 |
| Licensing hooks (FinCEN MSB, EU MiCA, etc.) | config in `admin.licenses`     |

## What this codebase ships

- Abstract **interfaces** for every compliance hook.
- One reference adapter per hook (a `mock` implementation) so the platform runs end-to-end out of the box.
- The **operator** must:
  1. Pick a licensed KYC vendor in your jurisdiction and write a real adapter.
  2. Configure sanctions list refresh.
  3. Define which user actions trigger which checks.
  4. Determine the legal classification of `﷼` and any launched token in your jurisdiction.
  5. File for any required money-transmission, e-money, or virtual-asset-service-provider licenses.

## No financial advice

Nothing in this repository is legal, tax, or investment advice.
