# منابع رسمی برای اجرای testnet و sandbox

## Solana

منبع رسمی clusterها: https://solana.com/docs/references/clusters

Solana Devnet برای توسعه عمومی است و endpoint رسمی آن `https://api.devnet.solana.com` است. توکن‌های Devnet واقعی نیستند، faucet برای airdrop دارند، ممکن است ledger reset شود و endpoint عمومی rate limit دارد. مستندات رسمی صراحتاً توصیه می‌کنند برای production از RPC اختصاصی استفاده شود.

منبع faucet رسمی: https://faucet.solana.com/

Faucet رسمی Solana برای Devnet/Testnet است و سقف درخواست دارد. برای اجرای programmatic، خود صفحه روش CLI و local validator را پیشنهاد می‌کند؛ این منبع برای گرفتن mainnet SOL نیست.

## Ethereum Sepolia

منبع faucet رسمی Google Cloud: https://cloud.google.com/application/web3/faucet/ethereum/sepolia

این faucet برای Sepolia ETH آزمایشی ارائه می‌کند. توکن‌ها ارزش واقعی ندارند و فقط برای توسعه و آزمایش قراردادها هستند. درخواست faucet به wallet address نیاز دارد و rate limit دارد.

## Stripe

منبع رسمی تست: https://docs.stripe.com/testing-use-cases

Stripe sandbox و test mode برای شبیه‌سازی payment objectها بدون انتقال پول واقعی هستند. کلیدهای test باید از Dashboard گرفته شوند و نباید در source یا فایل‌های commit‌شده قرار بگیرند. برای live payment باید بعداً live mode و account setup واقعی انجام شود.

## نتیجه اجرایی

برای توسعه بدون credential تجاری می‌توان از Solana Devnet، Ethereum Sepolia و Stripe test mode استفاده کرد. این‌ها محیط production نیستند و نباید با پرداخت واقعی یا mainnet اشتباه گرفته شوند. اجرای self-hosted زیرساخت‌هایی مانند PostgreSQL، Redis، NATS، Kafka و ClickHouse به Docker/Compose یا یک ماشین پایدار نیاز دارد؛ محیط فعلی Docker ندارد.
