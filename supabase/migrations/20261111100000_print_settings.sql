-- Simple browser printing: per-restaurant receipt settings.

alter table public.restaurants
  add column receipt_paper_width text not null default '80mm'
    check (receipt_paper_width in ('80mm', '58mm')),
  add column bill_header text check (char_length(bill_header) <= 300),
  add column bill_footer text check (char_length(bill_footer) <= 300);

-- Owners edit these like the rest of the restaurant profile (RLS: owner only).
grant update (receipt_paper_width, bill_header, bill_footer) on public.restaurants to authenticated;
