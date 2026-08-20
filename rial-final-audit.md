
## Matching execution authority

`MATCHING_ENABLED` اکنون در compose و `.env.example` صریح است و production validator آن را الزاماً `true` می‌خواهد. بنابراین fallback in-process matching نمی‌تواند به‌صورت ناخواسته جایگزین Rust matching-engine در production شود. validator پس از اصلاح syntax با `bash -n` موفق شد.
