-- pg_trgm extension + normalized-body generated column + trigram index
-- Per Stage-One §1.10: trigram search on Arabic text requires normalization.
-- Raw trigram matching on diacritized Arabic scores near zero against undiacritized
-- input. Common letter-form variance (alef-hamza forms, teh marbuta vs heh,
-- alef maksura vs yeh) causes real matches to be missed even without diacritics.
--
-- Normalization: strip tashkeel (U+064B–U+065F, U+0670), fold letter forms
-- (أإآٱ → ا, ة → ه, ى → ي), collapse repeated whitespace.

create extension if not exists pg_trgm;

create or replace function normalize_for_search(input text)
returns text
immutable
as $$
  select regexp_replace(
    translate(
      regexp_replace(input, '[\u064B-\u065F\u0670]', '', 'g'),
      'أإآٱةى',
      'ااااهي'
    ),
    '\s+', ' ', 'g'
  );
$$ language sql;

-- Generated column: body_normalized is always derived from body, never written directly.
-- STORED so it's materialized on disk and indexable by GIN.
alter table journal_entries
  add column body_normalized text
  generated always as (normalize_for_search(body)) stored;

-- GIN trigram index on the normalized column.
create index journal_entries_body_trgm_idx
  on journal_entries
  using gin (body_normalized gin_trgm_ops);
