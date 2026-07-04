create or replace function current_app_user()
returns uuid
language sql
security definer
stable
as $$
  select id from users where clerk_id = auth.jwt()->>'sub';
$$;

create or replace function is_in_subtree(ancestor uuid, descendant uuid)
returns boolean
language sql
security definer
stable
as $$
  with recursive tree as (
    select id, supervisor_id
    from users
    where id = descendant
    union all
    select u.id, u.supervisor_id
    from users u
    inner join tree t on u.id = t.supervisor_id
  )
  select exists (select 1 from tree where id = ancestor);
$$;