create table qa_escalations (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references qa_threads(id),
  escalated_to uuid not null references users(id),
  escalated_by uuid references users(id),
  reason text not null check (reason in ('ai_refusal', 'human_passed_up')),
  created_at timestamptz not null default now(),
  constraint escalated_by_matches_reason check (
    (reason = 'ai_refusal' and escalated_by is null)
    or (reason = 'human_passed_up' and escalated_by is not null)
  )
);

alter table qa_escalations enable row level security;

create policy qa_escalations_select
  on qa_escalations
  for select
  to authenticated
  using (
    escalated_to = current_app_user()
    or exists (
      select 1 from qa_threads qt
      where qt.id = qa_escalations.thread_id
        and qt.asker_id = current_app_user()
    )
    or exists (
      select 1 from qa_threads qt
      where qt.id = qa_escalations.thread_id
        and is_in_subtree(current_app_user(), qt.asker_id)
    )
    or is_in_subtree(current_app_user(), escalated_to)
  );
