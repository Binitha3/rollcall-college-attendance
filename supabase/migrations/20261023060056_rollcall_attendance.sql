create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function private.create_rollcall_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;
revoke all on function private.create_rollcall_profile() from public, anon, authenticated;

create trigger on_auth_user_created_rollcall
  after insert on auth.users
  for each row execute function private.create_rollcall_profile();

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  teacher_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.enrollments (
  course_id uuid not null references public.courses (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (course_id, student_id)
);

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id),
  created_by uuid not null references public.profiles (id),
  is_open boolean not null default true,
  started_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index one_open_session_per_course
  on public.class_sessions (course_id)
  where is_open;

create table public.session_secrets (
  session_id uuid primary key references public.class_sessions (id) on delete cascade,
  secret text not null check (length(secret) = 64)
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions (id),
  course_id uuid not null references public.courses (id),
  student_id uuid not null references public.profiles (id),
  device_id uuid not null,
  token_slot bigint not null,
  checked_in_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create table public.student_devices (
  id uuid primary key,
  student_id uuid not null references public.profiles (id) on delete cascade,
  public_key jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  enrolled_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles (id),
  revoked_at timestamptz,
  risk_flag boolean not null default false
);

create unique index one_active_device_key_per_student
  on public.student_devices (student_id)
  where status = 'approved';

create table public.device_challenges (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  device_id uuid not null references public.student_devices (id) on delete cascade,
  challenge text not null unique,
  expires_at timestamptz not null
);

create table public.device_change_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  device_id uuid not null references public.student_devices (id) on delete cascade,
  event_type text not null check (event_type in ('enrolled', 'approved', 'revoked')),
  created_at timestamptz not null default now()
);

create index enrollments_student_id_idx on public.enrollments (student_id);
create index class_sessions_course_started_idx on public.class_sessions (course_id, started_at desc);
create index attendance_student_course_idx on public.attendance (student_id, course_id);
create index student_devices_student_status_idx on public.student_devices (student_id, status);
create index device_challenges_expiry_idx on public.device_challenges (expires_at);
create index device_change_events_student_created_idx on public.device_change_events (student_id, created_at desc);

create or replace function private.is_course_teacher(course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses c where c.id = $1 and c.teacher_id = (select auth.uid())
  );
$$;

create or replace function private.is_enrolled_student(course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.enrollments e where e.course_id = $1 and e.student_id = (select auth.uid())
  );
$$;

create or replace function private.is_teacher_of_student(student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrollments e
    join public.courses c on c.id = e.course_id
    where e.student_id = $1 and c.teacher_id = (select auth.uid())
  );
$$;

revoke all on function private.is_course_teacher(uuid) from public, anon;
revoke all on function private.is_enrolled_student(uuid) from public, anon;
revoke all on function private.is_teacher_of_student(uuid) from public, anon;
grant execute on function private.is_course_teacher(uuid) to authenticated, service_role;
grant execute on function private.is_enrolled_student(uuid) to authenticated, service_role;
grant execute on function private.is_teacher_of_student(uuid) to authenticated, service_role;

create or replace function public.start_rollcall_session(
  p_course_id uuid,
  p_teacher_id uuid,
  p_session_id uuid,
  p_secret text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.teacher_id = p_teacher_id
  ) then
    raise exception 'Only the course teacher can start a session' using errcode = '42501';
  end if;

  insert into public.class_sessions (id, course_id, created_by)
  values (p_session_id, p_course_id, p_teacher_id);
  insert into public.session_secrets (session_id, secret)
  values (p_session_id, p_secret);
  return p_session_id;
end;
$$;

create or replace function public.record_rollcall_attendance(
  p_session_id uuid,
  p_student_id uuid,
  p_device_id uuid,
  p_token_slot bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.class_sessions%rowtype;
  attendance_id uuid;
begin
  select * into target_session
  from public.class_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
  if not target_session.is_open then
    raise exception 'Class session is closed' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.enrollments e
    where e.course_id = target_session.course_id and e.student_id = p_student_id
  ) then
    raise exception 'Student is not enrolled in this class' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.student_devices d
    where d.id = p_device_id and d.student_id = p_student_id and d.status = 'approved'
  ) then
    raise exception 'Device is not approved' using errcode = '42501';
  end if;

  insert into public.attendance (session_id, course_id, student_id, device_id, token_slot)
  values (target_session.id, target_session.course_id, p_student_id, p_device_id, p_token_slot)
  returning id into attendance_id;

  return attendance_id;
end;
$$;

create or replace function public.approve_rollcall_device(
  p_device_id uuid,
  p_approver_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_device public.student_devices%rowtype;
  approver_role text;
  revoked_device record;
begin
  select * into target_device
  from public.student_devices
  where id = p_device_id
  for update;

  if not found or target_device.status <> 'pending' then
    raise exception 'Device is not pending approval' using errcode = 'P0001';
  end if;

  select role into approver_role from public.profiles where id = p_approver_id;
  if approver_role is distinct from 'admin' and not exists (
    select 1
    from public.courses c
    join public.enrollments e on e.course_id = c.id
    where c.teacher_id = p_approver_id and e.student_id = target_device.student_id
  ) then
    raise exception 'Approver is not a teacher for this student' using errcode = '42501';
  end if;

  for revoked_device in
    update public.student_devices
    set status = 'revoked', revoked_at = now()
    where student_id = target_device.student_id and status = 'approved'
    returning id
  loop
    insert into public.device_change_events (student_id, device_id, event_type)
    values (target_device.student_id, revoked_device.id, 'revoked');
  end loop;

  update public.student_devices
  set status = 'approved', approved_at = now(), approved_by = p_approver_id
  where id = target_device.id and status = 'pending';

  insert into public.device_change_events (student_id, device_id, event_type)
  values (target_device.student_id, target_device.id, 'approved');

  return true;
end;
$$;

revoke all on function public.record_rollcall_attendance(uuid, uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.record_rollcall_attendance(uuid, uuid, uuid, bigint) to service_role;
revoke all on function public.start_rollcall_session(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.start_rollcall_session(uuid, uuid, uuid, text) to service_role;
revoke all on function public.approve_rollcall_device(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_rollcall_device(uuid, uuid) to service_role;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.class_sessions enable row level security;
alter table public.session_secrets enable row level security;
alter table public.attendance enable row level security;
alter table public.student_devices enable row level security;
alter table public.device_challenges enable row level security;
alter table public.device_change_events enable row level security;

create policy "Deny client access to session secrets"
  on public.session_secrets for all to authenticated
  using (false) with check (false);

create policy "Deny client access to device challenges"
  on public.device_challenges for all to authenticated
  using (false) with check (false);

revoke all on public.profiles, public.courses, public.enrollments, public.class_sessions,
  public.session_secrets, public.attendance, public.student_devices,
  public.device_challenges, public.device_change_events from anon, authenticated;
grant select on public.profiles, public.courses, public.enrollments,
  public.class_sessions, public.attendance, public.student_devices,
  public.device_change_events to authenticated;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Teachers can read their courses and students can read enrolled courses"
  on public.courses for select to authenticated
  using (
    private.is_course_teacher(id)
    or private.is_enrolled_student(id)
  );

create policy "Users can read relevant enrollments"
  on public.enrollments for select to authenticated
  using (
    student_id = (select auth.uid())
    or private.is_course_teacher(course_id)
  );

create policy "Course members can read class sessions"
  on public.class_sessions for select to authenticated
  using (
    created_by = (select auth.uid())
    or private.is_enrolled_student(course_id)
  );

create policy "Students and their teachers can read attendance"
  on public.attendance for select to authenticated
  using (
    student_id = (select auth.uid())
    or private.is_course_teacher(course_id)
  );

create policy "Students and their teachers can read device approval status"
  on public.student_devices for select to authenticated
  using (
    student_id = (select auth.uid())
    or private.is_teacher_of_student(student_id)
  );

create policy "Users and their teachers can read device change alerts"
  on public.device_change_events for select to authenticated
  using (
    student_id = (select auth.uid())
    or private.is_teacher_of_student(student_id)
  );
