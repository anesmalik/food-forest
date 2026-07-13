create table role_ranks (
  role user_role primary key,
  rank int not null unique
);

insert into role_ranks (role, rank) values
  ('admin', 0),
  ('consultant', 1),
  ('site_manager', 2),
  ('foreman', 3);

alter table role_ranks enable row level security;

create policy role_ranks_select_authenticated
  on role_ranks
  for select
  to authenticated
  using (true);
