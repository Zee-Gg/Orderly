-- Phase 7B: voice notes. Transcripts are saved on the message; every
-- transcription is logged in ai_logs like a chat turn (type = 'transcription').

alter table public.whatsapp_messages
  add column transcript text check (char_length(transcript) <= 4000),
  add column transcribe_provider text check (char_length(transcribe_provider) <= 40);

alter table public.ai_logs
  add column type text not null default 'chat' check (type in ('chat', 'transcription'));

create index ai_logs_type_idx on public.ai_logs (restaurant_id, type, created_at desc);
