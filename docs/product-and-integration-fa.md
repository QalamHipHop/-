# سند جامع محصول و یکپارچه‌سازی RIAL

**نویسندهٔ اصلاحات و سند:** QalamHipHop
**نسخهٔ بررسی:** working tree فعلی پروژه

## ۱. کلیت پروژه چیست؟

RIAL یک پلتفرم چندسرویسی برای ایجاد، عرضه، معامله و تسویهٔ دارایی‌های دیجیتال با واحد حساب داخلی ریال است. محصول از یک وب‌اپلیکیشن کاربرمحور، API gateway، سرویس‌های مالی و پرداخت، کیف‌پول و ledger، موتور matching، launchpad، قراردادهای هوشمند و زیرساخت عملیاتی تشکیل شده است.

به‌صورت محصولی، RIAL فقط یک «صفحهٔ خرید و فروش توکن» نیست. هستهٔ آن یک بازار دارایی دیجیتال است که باید چهار حقیقت را هم‌زمان درست نگه دارد: **هویت کاربر، مالکیت موجودی، وضعیت سفارش، و وضعیت تسویهٔ خارج از سیستم**. هر جا این چهار حقیقت از هم جدا شوند، ریسک double-credit، برداشت تکراری، سفارش phantom و اختلاف حساب ایجاد می‌شود.

## ۲. معماری فعلی

| لایه | اجزای موجود | مسئولیت واقعی |
|---|---|---|
| تجربهٔ کاربر | `frontend` با Next.js | ورود، ثبت‌نام، پورتفولیو، بازار، صفحهٔ launchpad و فرم سفارش |
| دروازهٔ API | `backend` با NestJS | احراز هویت، session، MFA، کاربران، wallet facade، trading facade، settlement و launchpad API |
| پرداخت | `payment-service` با NestJS | intent، adapterهای پرداخت، webhook، ثبت event و credit داخلی از مسیر wallet |
| دفترکل | `wallet-service` با Go | حساب‌ها، balance، ledger، lock/unlock، debit/credit، withdrawal و custody boundary |
| عرضهٔ توکن | `launchpad-service` با Go | ایجاد token، curve، خرید/فروش، graduation، risk AI و compensation |
| معاملات | `matching-engine` با Rust و `trading-engine` | order book، price-time priority، partial fill، TIF، fee و stream دادهٔ بازار |
| زنجیره | `smart-contracts` با Solidity/Hardhat | RIAL token، factory، launch pool، curve، vesting و کنترل دسترسی |
| رویداد و عملیات | PostgreSQL، Redis، NATS/Kafka، ClickHouse، observability | persistence، outbox، stream، analytics، recovery و پایش |

## ۳. امکانات موجود

### احراز هویت و حساب کاربری

Backend دارای مسیرهای ثبت‌نام و ورود، password service، access token، refresh/session، MFA و کنترل‌های کاربر است. هدف معماری شامل RBAC، scope، emergency pause و احراز هویت wallet نیز هست؛ اما فعال‌بودن هر provider باید در deployment واقعی با integration test اثبات شود.

### کیف‌پول و دفترکل

Wallet-service برای حساب کاربر و دارایی، available/locked balance، عملیات debit/credit، reserve و withdrawal طراحی شده است. اصلاحات اخیر idempotency برداشت، lifecycle چندامضایی و fail-closed شدن custody توسعه‌ای را فعال کرده‌اند. در production، memory signer جای HSM/KMS را نمی‌گیرد و باید provider واقعی نصب شود.

### پرداخت و سپرده

Payment-service با adapterهای provider-agnostic برای Stripe، manual و providerهای دیگر طراحی شده است. webhook پس از اصلاحات در جدول event ثبت می‌شود، duplicate قابل تشخیص است و deposit موفق زمانی نهایی تلقی می‌شود که credit idempotent در wallet-service انجام شده باشد.

### معامله و موتور تطبیق

موتور matching سفارش‌های limit و market، خرید/فروش، IOC/FOK، partial fill، fee و price-time priority را پشتیبانی می‌کند. fallback داخلی backend به صف واقعی maker مجهز شده و self-trade حذف شده است. matching-engine Rust نیز order book واقعی دارد؛ streamهای `order book` و `trades` اکنون از broadcaster داخلی تغذیه می‌شوند و پس از submit رویداد منتشر می‌کنند.

### Launchpad و bonding curve

Launchpad برای ایجاد token، اعتبارسنجی curve، stake creator، risk AI، خرید/فروش، graduation و compensation طراحی شده است. policy جدید `risk_fail_closed` باعث می‌شود در production ازکارافتادن risk AI به ایجاد token منجر نشود.

### قراردادهای هوشمند

قراردادها با Hardhat compile می‌شوند و suite فعلی شامل deployment، role control، mint، pool، fee limits، curve monotonicity و RBAC است. این suite رفتارهای on-chain پایه را پوشش می‌دهد، ولی audit مستقل، invariant fuzzing و deployment روی testnet/mainnet هنوز الزام production هستند.

### تجربهٔ frontend

صفحات login، register، trade، portfolio، launchpad، admin و settings موجود هستند. داده‌های synthetic و قیمت‌های تصادفی حذف شده‌اند؛ اگر API داده ندهد، UI باید unavailable را نشان دهد و اطلاعات جعلی تولید نکند.

## ۴. جریان‌های end-to-end

### سپرده تا موجودی

کاربر intent سپرده می‌سازد، provider پرداخت event می‌فرستد، signature و event id بررسی می‌شوند، event به‌صورت idempotent ثبت می‌شود، سپس payment-service credit داخلی را با reference یکتا به wallet-service می‌فرستد. wallet ledger credit می‌کند و بعد intent به succeeded می‌رسد. هر retry باید همان نتیجه را برگرداند، نه یک credit تازه.

### سفارش تا معامله

کاربر سفارش را با JWT و `client_id` ارسال می‌کند. backend آن را validate و reserve می‌کند، سپس به matcher داخلی یا خارجی می‌فرستد. matcher maker را با price-time priority پیدا می‌کند، trade را ثبت می‌کند و orderهای هر دو طرف را update می‌کند. settlement باید quote را از buyer و base را از seller کم و دارایی متناظر را به طرف مقابل credit کند. رویداد trade و order book به مصرف‌کننده‌های market-data می‌رسد.

### برداشت تا broadcast

درخواست برداشت ابتدا validate، risk-check و idempotency می‌شود. موجودی reserve می‌شود، withdrawal به pending می‌رود، امضاها جمع می‌شوند و فقط پس از threshold به broadcast می‌رسد. confirm روی broadcast معتبر، confirmed را ثبت می‌کند و retry روی confirmed نباید دوباره balance را کم کند. خطای broadcast باید مسیر compensation یا manual review داشته باشد.

### ایجاد token تا graduation

creator درخواست ساخت می‌دهد، curve و stake و token metadata validate می‌شود، risk AI تصمیم می‌دهد، token در persistence ثبت می‌شود و خرید/فروش روی curve انجام می‌گیرد. وقتی threshold تکمیل شد، graduation باید با یک state machine durable، outbox و recovery ادامه پیدا کند؛ «ثبت موفق در یک سرویس» به‌تنهایی graduation کامل محسوب نمی‌شود.

## ۵. نیازهای جدید برای نسخهٔ واقعی

| اولویت | نیاز | معیار پذیرش |
|---|---|---|
| P0 | source of truth واحد برای ledger | هیچ balance mutation خارج از wallet ledger مجاز نباشد و هر mutation reference یکتا داشته باشد |
| P0 | custody واقعی | production با memory signer بالا نیاید؛ Vault/KMS/HSM و rotation تست شده باشد |
| P0 | settlement اتمیک یا saga قابل‌بازگشت | crash بین order، trade و wallet باعث اختلاف موجودی نشود |
| P0 | matching خارجی durable | snapshot، WAL، replay، leader/partition و duplicate event تست شود |
| P0 | webhook و credit recovery | event نیمه‌کاره پس از restart قابل reconcile و alert باشد |
| P0 | migration و backup واقعی | migration versioned، backup encrypted، restore drill و checksum موجود باشد |
| P1 | contract tests بین سرویس‌ها | payment↔wallet، backend↔matching و launchpad↔wallet در CI contract test داشته باشند |
| P1 | observability مالی | correlation ID، audit hash chain، metrics برای pending/failed/retry و alert عملیاتی وجود داشته باشد |
| P1 | KYC/AML و sanctions | threshold و jurisdiction واقعی با provider قابل‌تعویض و decision audit شود |
| P1 | admin عملیات | freeze user/market، manual review، retry، refund، reconciliation و approval چندمرحله‌ای موجود باشد |
| P1 | market-data واقعی | ClickHouse candle pipeline و WebSocket auth/rate-limit از اول تا آخر تست شود |
| P2 | تجربهٔ محصول | onboarding، deposit/withdraw UI، order history، fee disclosure، risk disclosure و localization کامل شود |
| P2 | اقتصاد و مدل کارمزد | platform/creator/referral/treasury/burn به‌صورت شفاف و قابل‌حسابرسی تعریف شود |

## ۶. شکاف‌های فعلی که باید در ادامه بسته شوند

اول، custody واقعی هنوز نیازمند adapter رسمی Vault/KMS/HSM است. Memory signer اکنون برای development کنترل شده است، اما امنیت production با آن حل نمی‌شود.

دوم، external matching consumer هنوز باید با persistence، deduplication، replay و settlement واقعی به backend وصل شود. stream داخلی matching-engine اکنون functional است، ولی stream functional به‌تنهایی به معنی distributed recovery نیست.

سوم، payment-to-wallet باید با PostgreSQL واقعی، timeout، retry، dead-letter و reconciliation روزانه تست شود. unit test بدون database واقعی نمی‌تواند transaction boundary را اثبات کند.

چهارم، frontend هنوز همهٔ عملیات مالی محصول را به‌صورت کامل ارائه نمی‌کند. دکمه‌های deposit و withdraw، order history، admin review و بعضی داده‌های account باید به endpoint واقعی وصل شوند، نه فقط به layout.

پنجم، قراردادهای on-chain نیازمند invariant test، fuzzing، paused-state test، upgrade/admin threat review و deployment verification روی testnet هستند.

## ۷. تعریف «یکپارچه» برای پروژه

پروژه زمانی یکپارچه تلقی می‌شود که برای هر عملیات مالی یک correlation ID از frontend تا gateway، payment/trading/launchpad، wallet ledger، outbox و audit وجود داشته باشد؛ هر سرویس قرارداد versioned داشته باشد؛ همهٔ retryها idempotent باشند؛ failure stateها قابل مشاهده و قابل recovery باشند؛ و مستندات deployment با رفتار واقعی کد یکی باشد.

در نتیجه، یکپارچه‌سازی فقط کنار هم قرار دادن سرویس‌ها یا موفق‌شدن build نیست. معیار واقعی، حفظ invariant زیر در crash، retry، duplicate event و restart است:

> **مجموع دارایی‌ها، بدهی‌ها، locked funds و ledger entries باید پس از هر عملیات یا دقیقاً همان مقدار قبل بماند یا با یک transition ثبت‌شده و قابل‌حسابرسی تغییر کند.**

## ۸. مسیر اجرایی پیشنهادی

در گام بعد باید ابتدا contract testهای wallet/payment و wallet/trading اضافه شوند. سپس provider custody واقعی و integration environment با PostgreSQL، Redis و NATS بالا بیاید. بعد matching خارجی با replay و fault injection تست شود. پس از آن UI عملیات مالی کامل شود و در پایان security review، load test، restore drill، testnet deployment و go/no-go انجام گیرد.

نسخهٔ فعلی از نظر build و unit behavior پایه قابل‌اجرا است، اما تا زمانی که سه gate custody واقعی، integration settlement و distributed recovery با شواهد اجرایی بسته نشوند، نباید به‌عنوان سامانهٔ مالی production معرفی شود.
