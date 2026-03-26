-- Allow discipline to be NULL so Discipline Classifier Agent can target unclassified rows
ALTER TABLE public.parsed_comments
  ALTER COLUMN discipline DROP NOT NULL;
