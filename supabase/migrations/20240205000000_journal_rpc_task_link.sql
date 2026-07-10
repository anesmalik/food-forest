-- Add task_id and task_title to journal_page and journal_search RPCs
-- so the linked task is visible on journal entry cards.
-- Must drop first because return types changed.

drop function if exists journal_page(int, timestamptz, uuid, uuid);
drop function if exists journal_search(text, int);

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
  task_id uuid,
  task_title text,
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
    je.task_id,
    t.title as task_title,
    e.id as entity_id,
    e.name as entity_name,
    e.type as entity_type
  from journal_entries je
  left join users u on u.id = je.author_id
  left join journal_entries corrected on corrected.id = je.corrects_entry_id
  left join tasks t on t.id = je.task_id
  left join journal_entry_entities jee on jee.journal_entry_id = je.id
  left join entities e on e.id = jee.entity_id
  where
    (p_author_filter is null or je.author_id = p_author_filter)
    and (
      p_cursor_created_at is null
      or (je.created_at, je.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by je.created_at desc, je.id desc
  limit p_limit;
$$;

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
  task_id uuid,
  task_title text,
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
    je.task_id,
    t.title as task_title,
    e.id as entity_id,
    e.name as entity_name,
    e.type as entity_type
  from journal_entries je
  left join users u on u.id = je.author_id
  left join journal_entries corrected on corrected.id = je.corrects_entry_id
  left join tasks t on t.id = je.task_id
  left join journal_entry_entities jee on jee.journal_entry_id = je.id
  left join entities e on e.id = jee.entity_id
  where
    je.body_normalized ilike '%' || p_query || '%'
    or je.body_normalized % p_query
  order by je.created_at desc, je.id desc
  limit p_limit;
$$;
