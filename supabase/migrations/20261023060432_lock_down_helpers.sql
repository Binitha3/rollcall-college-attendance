create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

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

drop trigger if exists on_auth_user_created_rollcall on auth.users;
drop function if exists public.create_rollcall_profile();
create trigger on_auth_user_created_rollcall
  after insert on auth.users
  for each row execute function private.create_rollcall_profile();

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

drop policy if exists "Teachers can read their courses and students can read enrolled courses" on public.courses;
drop policy if exists "Users can read relevant enrollments" on public.enrollments;
drop policy if exists "Course members can read class sessions" on public.class_sessions;
drop policy if exists "Students and their teachers can read attendance" on public.attendance;
drop policy if exists "Students and their teachers can read device approval status" on public.student_devices;
drop policy if exists "Users and their teachers can read device change alerts" on public.device_change_events;
drop policy if exists "Deny client access to session secrets" on public.session_secrets;
drop policy if exists "Deny client access to device challenges" on public.device_challenges;

drop function if exists public.is_course_teacher(uuid);
drop function if exists public.is_enrolled_student(uuid);
drop function if exists public.is_teacher_of_student(uuid);

create policy "Deny client access to session secrets"
  on public.session_secrets for all to authenticated
  using (false) with check (false);

create policy "Deny client access to device challenges"
  on public.device_challenges for all to authenticated
  using (false) with check (false);

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
