-- whatsapp-inbound.sql
-- Persistent log of inbound WhatsApp webhook deliveries (Meta WhatsApp Cloud
-- API). Used so status callbacks (delivered/read), template failures, and
-- inbound user replies are never silently dropped — every payload landing on
-- /api/whatsapp-webhook is persisted before the route returns 200.
--
-- Apply with: psql / Supabase SQL editor / your migration runner.

create table if not exists whatsapp_inbound (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  source text not null,                          -- e.g. "meta_webhook"
  message_id text,                               -- WAMID from messages[0].id (when present)
  status text,                                   -- delivered/read/failed/etc. (when status callback)
  from_phone text,                               -- E.164 number (when present)
  to_phone text,                                 -- E.164 number (when present)
  template_name text,                            -- WA template name (when present)
  payload jsonb not null
);

create index if not exists whatsapp_inbound_received_at_idx
  on whatsapp_inbound (received_at desc);

create index if not exists whatsapp_inbound_message_id_idx
  on whatsapp_inbound (message_id)
  where message_id is not null;

create index if not exists whatsapp_inbound_status_idx
  on whatsapp_inbound (status)
  where status is not null;

-- RLS: service-role inserts only. The route uses the admin (service-role)
-- Supabase client, so RLS does not need a permissive policy. Enable RLS
-- so anon/authenticated clients cannot read raw inbound payloads (which
-- may contain phone numbers and message bodies).
alter table whatsapp_inbound enable row level security;
