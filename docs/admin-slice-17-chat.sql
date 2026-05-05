create table if not exists public.chat_threads (
  thread_id text primary key,
  task_id text not null,
  user_phone text not null default '',
  provider_id text not null default '',
  provider_phone text not null default '',
  category text null,
  area text null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz null,
  last_message_by text null,
  unread_user_count integer not null default 0,
  unread_provider_count integer not null default 0,
  thread_status text not null default 'active',
  moderation_reason text null,
  last_moderated_at timestamptz null,
  last_moderated_by text null
);

create index if not exists idx_chat_threads_task_id
  on public.chat_threads (task_id);

create index if not exists idx_chat_threads_provider_id
  on public.chat_threads (provider_id);

create index if not exists idx_chat_threads_last_message_at
  on public.chat_threads (last_message_at desc nulls last);

create table if not exists public.chat_messages (
  message_id text primary key,
  thread_id text not null references public.chat_threads (thread_id) on delete cascade,
  task_id text not null,
  sender_type text not null,
  sender_phone text not null default '',
  sender_name text null,
  message_text text not null,
  message_type text not null default 'text',
  created_at timestamptz not null default now(),
  read_by_user text not null default 'no',
  read_by_provider text not null default 'no',
  moderation_status text not null default 'clear',
  flag_reason text null,
  contains_blocked_word text not null default 'no'
);

create index if not exists idx_chat_messages_thread_created_at
  on public.chat_messages (thread_id, created_at asc);
