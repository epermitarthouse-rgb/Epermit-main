-- Explicit onboarding completion flag on profiles (replaces full_name / project heuristics).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.onboarding_completed IS
  'When true, the dashboard onboarding wizard has been completed. New users default to false.';

-- Existing production users have already been using the app — treat them as completed.
UPDATE public.profiles
SET onboarding_completed = true
WHERE onboarding_completed = false;

-- New auth signups: profile row starts with onboarding_completed = false.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    full_name,
    company_name,
    job_title,
    phone,
    onboarding_completed
  )
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'company_name',
    NEW.raw_user_meta_data ->> 'job_title',
    NEW.raw_user_meta_data ->> 'phone',
    false
  );
  RETURN NEW;
END;
$$;
