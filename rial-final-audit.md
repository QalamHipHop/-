
## Matching execution authority

`MATCHING_ENABLED` اکنون در compose و `.env.example` صریح است و production validator آن را الزاماً `true` می‌خواهد. بنابراین fallback in-process matching نمی‌تواند به‌صورت ناخواسته جایگزین Rust matching-engine در production شود. validator پس از اصلاح syntax با `bash -n` موفق شد.

## Post-commit continuation fixes

راستی‌آزمایی repository پس از commit نشان داد کد واقعاً در `main` و در commit `59c560c` ثبت شده است. در ادامهٔ بررسی، دو شکاف جدید بسته شد:

۱. launchpad gRPC در helperهای `parseInt64` و `mustUUID` خطا را نادیده می‌گرفت و ورودی malformed را به zero UUID/int64 تبدیل می‌کرد. اکنون UUID، amount، vesting total و graduation threshold قبل از هر domain mutation صریحاً validate می‌شوند و regression tests برای این boundary اضافه شده‌اند.

۲. frontend portfolio به endpoint ناموجود `/api/portfolio/positions` وصل بود و در خطا کارت‌های summary را به صفر تبدیل می‌کرد. اکنون summary از `/api/wallet/summary` واقعی خوانده می‌شود، token accountهای واقعی نمایش داده می‌شوند، و تا وقتی market price واقعی وجود ندارد valuation/P&L صریحاً unavailable است؛ هیچ price یا position مصنوعی ساخته نمی‌شود.

نتیجهٔ validation: `go test ./...` در launchpad و TypeScript/lint/production build فرانت‌اند موفق شد.

۳. launchpad HTTP API نیز در quote/buy/sell invalid path UUID را silent به `uuid.Nil` تبدیل می‌کرد. اکنون هر سه handler پیش از decode/domain call خطای `INVALID_ID` برمی‌گردانند. `gofmt` و `go test ./...` launchpad پس از اصلاح موفق شدند.

۴. monetary contractهای launchpad در gateway و HTTP API از JSON number به decimal string منتقل شدند: `amount_in_minor` و `graduation_rial_minor` اکنون digits-only string هستند و فقط داخل Go با parseInt64 کنترل‌شده به int64 تبدیل می‌شوند. frontend نیز `graduation_rial_minor` را string می‌داند. این تغییر از precision loss در JavaScript/JSON جلوگیری می‌کند. validation کامل Go، backend و frontend موفق شد.

۵. settlement recovery payment-service فقط candidateها را list می‌کرد و برای چند replica lease نداشت؛ بنابراین در failure/retry همزمان، چند worker می‌توانست یک wallet credit را concurrently صدا بزند. اکنون migration `0015-payment-settlement-lease.sql` ستون‌های claim token/time و index recovery را اضافه می‌کند، `IntentStore.claimSettlement` با UPDATE شرطی claim اتمیک انجام می‌دهد، و success/failure/pending claim را پاک می‌کنند. downstream idempotency key همچنان barrier نهایی است.
