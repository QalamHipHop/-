# گزارش اجرای واقعی و اعتبارسنجی Runtime

**مالک و نویسنده: Qalamhiphop**  
**تاریخ اجرا: ۱۵ اوت ۲۰۲۶**  
**محیط: Docker Compose توسعه، PostgreSQL/Redis/Kafka/NATS/ClickHouse محلی، Ethereum Sepolia و Solana Devnet**

## نتیجه اجرایی

پلتفرم در محیط توسعه به یک stack قابل‌اجرا ارتقا یافت. Gateway، frontend، wallet ledger، launchpad، payment، notification، analytics، AI engine، matching engine و trading engine هم‌زمان بالا هستند. بررسی مستقیم `eth_chainId` مقدار `0xaa36a7` را از RPC Sepolia و `getHealth=ok` را از Solana Devnet برگرداند؛ بنابراین اتصال شبکه‌های testnet واقعاً برقرار است، نه یک مقدار ساختگی. Sepolia شبکه آزمایشی Ethereum برای آزمایش قراردادهاست و endpoint عمومی PublicNode نیز برای اتصال توسعه‌ای ارائه می‌شود.[1] [2]

| مؤلفه | وضعیت قابل‌اثبات | مسیر/شاهد |
|---|---|---|
| Frontend Next.js | سالم | `GET :3000/api/health` پاسخ `ok` |
| Backend NestJS | سالم | `GET :8080/v1/readyz`؛ PostgreSQL، Redis و NATS همگی `up` |
| Wallet service | سالم | `GET :50053/readyz` پاسخ `ready` |
| Launchpad service | سالم | `GET :50054/healthz` پاسخ `ok` |
| Payment service | سالم | `GET :50055/healthz` پاسخ `ok` |
| Notification service | سالم | `GET :50056/healthz` پاسخ `OK` |
| Analytics | سالم | `GET :50057/readyz`؛ ClickHouse و Redis هر دو `ok` |
| AI engine | سالم | `GET :50058/healthz` پاسخ `ok` |
| Matching engine | سالم | healthcheck Docker سبز |
| Trading engine | در حال اجرا | gRPC service فعال روی پورت `50052` |
| Testnet RPC | تأیید شد | `scripts/verify-testnets.py` با exit code صفر |

## مسیر end-to-end اثبات‌شده

آزمون `scripts/e2e-launchpad-ledger.sh` با یک کاربر seed شده در پایگاه‌داده واقعی اجرا شد. این آزمون ابتدا از API واقعی wallet یک credit توسعه‌ای ثبت می‌کند، سپس از HTTP API واقعی launchpad یک token ایجاد و تأیید می‌کند، quote دریافت می‌کند و خرید را اجرا می‌کند. خرید باعث ثبت یک debit با `Type=trade` در جدول واقعی wallet ledger و ثبت holder/bonding state در PostgreSQL شد.

در آزمون انجام‌شده، پاسخ buy دارای `trade_id` واقعی و `tx_hash` برابر با شناسه تراکنش wallet ledger بود؛ دیگر شناسه تصادفی با پیشوند `0x` برای این مسیر ساخته نمی‌شود. retry با همان `client_id` پاسخ ذخیره‌شده را دقیقاً بازگرداند و یک debit دوم یا افزایش دوم holder ایجاد نکرد. فروش نیز با کنترل موجودی holder اجرا و مبلغ خروجی را با `Type=trade` در wallet ledger credit کرد؛ retry فروش با همان `client_id` نیز همان پاسخ ذخیره‌شده را بازگرداند.

| کنترل | رفتار پیاده‌سازی‌شده |
|---|---|
| Settlement خرید | پیش از تغییر مالکیت token، debit idempotent از wallet ledger انجام می‌شود. |
| Settlement فروش | پس از کنترل موجودی token، credit idempotent با نوع `trade` در wallet ledger ثبت می‌شود. |
| Idempotency | جدول `launchpad.trade_requests` با کلید یکتای `(token_id, user_id, client_id)` نتیجه سفارش را ماندگار می‌کند. |
| Retry امن | buy و sell با `client_id` یکسان همان نتیجه‌ی ذخیره‌شده را بازمی‌گردانند. |
| جبران خطا | در خطای update حالت بعد از settlement، مسیر جبران wallet و بازگردانی state اجرا می‌شود و خطای جبران ثبت می‌گردد. |
| Healthcheck | healthcheck backend با URI versioned واقعی (`/v1/readyz`) هم‌راستا شد. |

## تغییرات کلیدی

| حوزه | تغییر |
|---|---|
| Runtime imageها | Dockerfileهای backend، notification، analytics و wallet برای runtime کم‌حجم‌تر و جلوگیری از فشار inode اصلاح شدند. |
| Backend/notification | backend با GraphQL schema قابل‌نوشتن برای user غیرroot اجرا شد؛ circular import notification رفع شد. |
| Matching/trading | toolchain Rust، protobuf headers، ownership، health و runtime config اصلاح شدند تا سرویس‌ها build و اجرا شوند. |
| Analytics | lifecycle ClickHouse/Kafka، وابستگی‌های runtime، entrypoint و schema GraphQL اصلاح شدند. |
| Launchpad | wallet client داخلی اضافه شد؛ debit/credit واقعی ledger، idempotency ماندگار و کنترل موجودی فروش فعال شدند. |
| Migrations | `wallet-service/migrations/0001_init.sql` و `database/postgres/migrations/0003-launchpad-trade-requests.sql` برای محیط اجرا اعمال شدند. |
| Testnet | script تکرارپذیر `scripts/verify-testnets.py` اتصال Sepolia و Solana Devnet را بررسی می‌کند. |

## مرز شفاف محیط توسعه و production

> این وضعیت یک runtime توسعه‌ی واقعی با ledger و testnet connectivity است؛ **هنوز یک custody یا launch on-chain production با پول واقعی نیست**.

مهم‌ترین مرز باقی‌مانده، اجرای on-chain mint/deploy است. API فعلی launchpad قرارداد یا mint را از ورودی دریافت می‌کند و settlement را در wallet ledger داخلی انجام می‌دهد؛ هنوز adapter امضای تراکنش و deploy/mint واقعی برای Solana Devnet یا Ethereum Sepolia را در flow launch صدا نمی‌زند. اجرای چنین تراکنش آزمایشی نیز به مصرف testnet gas/faucet balance و استفاده از کلید پیکربندی‌شده نیاز دارد و باید پیش از اقدام با تأیید صریح مالک انجام شود.

برای production، کلیدهای Stripe live، secret manager، KMS/HSM یا MPC custody، allowlist/role enforcement برای approval توکن، ذخیره‌سازی رمزگذاری‌شده کلیدها، provider اختصاصی RPC، monitoring/alerting و audit/incident process باید پیش از پذیرش دارایی واقعی تکمیل شوند. Endpointهای عمومی RPC برای توسعه و تست سبک مناسب‌اند، اما مبنای قابل‌اتکا برای production نیستند.[1]

## اجرای مجدد

```bash
cd /home/ubuntu/project-minus
bash scripts/bootstrap.sh
python3 scripts/verify-testnets.py
bash scripts/e2e-launchpad-ledger.sh
```

## منابع

[1]: https://ethereum-sepolia-rpc.publicnode.com/ "Ethereum Sepolia RPC — PublicNode"
[2]: https://ethereum.org/developers/docs/networks/ "Ethereum networks and testnets"

