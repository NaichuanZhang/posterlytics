ALTER TABLE public.campaigns
  ADD COLUMN eager_capture_url TEXT,
  ADD COLUMN eager_capture_color_scheme TEXT,
  ADD COLUMN eager_captured_at TIMESTAMPTZ;

GRANT UPDATE (
  design_tokens,
  brand_assets,
  screenshot_url,
  screenshot_key,
  eager_capture_url,
  eager_capture_color_scheme,
  eager_captured_at
) ON public.campaigns TO authenticated;
