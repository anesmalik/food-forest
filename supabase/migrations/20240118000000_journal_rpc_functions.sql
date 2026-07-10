-- RPC functions for journal pagination and search.
-- These functions run with the caller's role (NOT SECURITY DEFINER), so RLS
-- on journal_entries, journal_entry_entities, users, and entities applies
-- automatically — results are scoped to author + ancestor chain.
--
-- Critical tombstone requirement (§1.11): when soft_deleted_at is set, body
-- is NOT returned at all — not selected, not in the response. This is a
-- query-shape choice enforced here at the function level, not a UI rendering
-- choice. The CASE expression returns NULL for body when tombstoned.

create or replace function journal_page(
  p_limit int default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_author_filter uuid default null
)
returns table (
  id uuid,
  author_id uuid,
  author_name text,
  body text,
  sensitivity sensitivity,
  created_at timestamptz,
  soft_deleted_at timestamptz,
  corrects_entry_id uuid,
  corrects_entry_created_at timestamptz,
  entity_id uuid,
  entity_name text,
  entity_type text
)
language sql
stable
as $$
  select
    je.id,
    je.author_id,
    u.display_name as author_name,
    -- Tombstone: body is NULL when soft_deleted_at is set. Not styled out — absent.
    case when je.soft_deleted_at is not null then null else je.body end as body,
    je.sensitivity,
    je.created_at,
    je.soft_deleted_at,
    je.corrects_entry_id,
    corrected.created_at as corrects_entry_created_at,
    e.id as entity_id,
    e.name as entity_name,
    e.type as entity_type
  from journal_entries je
  left join users u on u.id = je.author_id
  left join journal_entries corrected on corrected.id = je.corrects_entry_id
  left join journal_entry_entities jee on jee.journal_entry_id = je.id
  left join entities e on e.id = jee.entity_id
  where
    -- Author filter (optional — for filtering to a specific person's entries)
    (p_author_filter is null or je.author_id = p_author_filter)
    -- Cursor pagination: (created_at, id) descending
    and (
      p_cursor_created_at is null
      or (je.created_at, je.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by je.created_at desc, je.id desc
  limit p_limit;
$$;

-- Search journal entries by trigram similarity on normalized body.
-- The query string should be normalized client-side via the same folds as
-- normalize_for_search() before being passed here, so query and stored text
-- meet in the same normalized space.
--
-- Uses both ILIKE (substring match, trigram-indexed) and % (similarity operator)
-- for fuzzy matching. Provisional/keyword-only — stage two's embeddings are
-- the real retrieval story.
create or replace function journal_search(
  p_query text,
  p_limit int default 50
)
returns table (
  id uuid,
  author_id uuid,
  author_name text,
  body text,
  sensitivity sensitivity,
  created_at timestamptz,
  soft_deleted_at timestamptz,
  corrects_entry_id uuid,
  corrects_entry_created_at timestamptz,
  entity_id uuid,
  entity_name text,
  entity_type text
)
language sql
stable
as $$
  select
    je.id,
    je.author_id,
    u.display_name as author_name,
    case when je.soft_deleted_at is not null then null else je.body end as body,
    je.sensitivity,
    je.created_at,
    je.soft_deleted_at,
    je.corrects_entry_id,
    corrected.created_at as corrects_entry_created_at,
    e.id as entity_id,
    e.name as entity_name,
    e.type as entity_type
  from journal_entries je
  left join users u on u.id = je.author_id
  left join journal_entries corrected on corrected.id = je.corrects_entry_id
  left join journal_entry_entities jee on jee.journal_entry_id = je.id
  left join entities e on e.id = jee.entity_id
  where
    je.body_normalized ilike '%' || p_query || '%'
    or je.body_normalized % p_query
  order by je.created_at desc, je.id desc
  limit p_limit;
$$;
