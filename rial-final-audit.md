
## Matching execution authority

`MATCHING_ENABLED` اکنون در compose و `.env.example` صریح است و production validator آن را الزاماً `true` می‌خواهد. بنابراین fallback in-process matching نمی‌تواند به‌صورت ناخواسته جایگزین Rust matching-engine در production شود. validator پس از اصلاح syntax با `bash -n` موفق شد.

## Post-commit continuation fixes

راستی‌آزمایی repository پس از commit نشان داد کد واقعاً در `main` و در commit `59c560c` ثبت شده است. در ادامهٔ بررسی، دو شکاف جدید بسته شد:

۱. launchpad gRPC در helperهای `parseInt64` و `mustUUID` خطا را نادیده می‌گرفت و ورودی malformed را به zero UUID/int64 تبدیل می‌کرد. اکنون UUID، amount، vesting total و graduation threshold قبل از هر domain mutation صریحاً validate می‌شوند و regression tests برای این boundary اضافه شده‌اند.

۲. frontend portfolio به endpoint ناموجود `/api/portfolio/positions` وصل بود و در خطا کارت‌های summary را به صفر تبدیل می‌کرد. اکنون summary از `/api/wallet/summary` واقعی خوانده می‌شود، token accountهای واقعی نمایش داده می‌شوند، و تا وقتی market price واقعی وجود ندارد valuation/P&L صریحاً unavailable است؛ هیچ price یا position مصنوعی ساخته نمی‌شود.

نتیجهٔ validation: `go test ./...` در launchpad و TypeScript/lint/production build فرانت‌اند موفق شد.
