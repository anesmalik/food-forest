-- T6.3: qa_citations INSERT policy
-- Restricts citation-attaching to the author of the specific answer version being cited.
-- Mirrors qa_answer_versions_insert policy pattern: verify ownership via join chain.

create policy qa_citations_insert
  on qa_citations
  for insert
  to authenticated
  with check (
    exists (
      select 1 from qa_answer_versions qav
      join qa_answers qa on qa.id = qav.answer_id
      where qav.id = answer_version_id
        and qa.answerer_id = current_app_user()
    )
  );
