-- Serial review for equipment nameplate reads (Gemini 3.8 Flash, Claude Sonnet 5.5 backup).

alter table public.property_inspection_photos
  add column if not exists serial_review jsonb;

comment on column public.property_inspection_photos.serial_review is
  'Serial OCR review: uncertain characters, brand format check, retake prompt, and which model read the label.';
