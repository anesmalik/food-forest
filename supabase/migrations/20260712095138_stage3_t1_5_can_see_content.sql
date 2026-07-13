create or replace function can_see_content(p_content_type content_type, p_content_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  caller_id uuid;
  caller_rank int;
  author_id uuid;
  author_rank int;
  content_sensitivity sensitivity;
begin
  caller_id := current_app_user();
  if caller_id is null then
    return false;
  end if;

  if p_content_type in ('qa_question', 'qa_answer_version') then
    return true;
  end if;

  if p_content_type = 'journal_entry' then
    select je.author_id, je.sensitivity
    into author_id, content_sensitivity
    from journal_entries je
    where je.id = p_content_id;
  elsif p_content_type = 'wiki_entry_version' then
    select we.owner_id, wev.sensitivity
    into author_id, content_sensitivity
    from wiki_entry_versions wev
    join wiki_entries we on we.id = wev.wiki_entry_id
    where wev.id = p_content_id;
  else
    return false;
  end if;

  if author_id is null then
    return false;
  end if;

  if author_id is not distinct from caller_id then
    return true;
  end if;

  if content_sensitivity = 'restricted' then
    return is_in_subtree(caller_id, author_id);
  else
    select rr.rank into caller_rank
    from users u
    join role_ranks rr on rr.role = u.role
    where u.id = caller_id;

    select rr.rank into author_rank
    from users u
    join role_ranks rr on rr.role = u.role
    where u.id = author_id;

    if author_rank is null or caller_rank is null then
      return false;
    end if;

    return author_rank >= caller_rank;
  end if;
end;
$$;

grant execute on function can_see_content(content_type, uuid) to authenticated;
