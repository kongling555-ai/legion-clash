create table if not exists commanders (
  token text primary key,
  roster jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists rooms (
  code text primary key,
  mode text not null,
  host_token text not null,
  guest_token text,
  version integer not null default 1,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists rooms_updated_idx on rooms (updated_at);
