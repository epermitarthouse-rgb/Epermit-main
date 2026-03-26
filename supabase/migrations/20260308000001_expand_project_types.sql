-- Expand project_type enum with comprehensive construction/permit categories
-- Based on DC DOB PermitWizard and DMV jurisdiction permit types

ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'interior_renovation';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'exterior_renovation';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'change_of_use';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'foundation';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'structural_modification';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'mep_upgrade';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'fire_protection';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'roofing';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'facade';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'site_work';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'excavation';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'sheeting_shoring';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'crane_derrick';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'solar_installation';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'sign_awning';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'elevator_conveyance';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'pool_spa';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'retaining_wall';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'deck_porch';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'fence_gate';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'accessory_structure';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'historic_preservation';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'accessibility_ada';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'environmental_remediation';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'right_of_way';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'grading_sediment';
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'temporary_structure';
