ALTER TABLE projects ADD COLUMN IF NOT EXISTS portal_data_hash text;

ALTER TABLE projects REPLICA IDENTITY FULL;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION notify_shadow_prediction_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  supabase_url text;
  service_role_key text;
BEGIN
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_role_key := current_setting('app.settings.service_role_key', true);

  IF supabase_url IS NOT NULL AND service_role_key IS NOT NULL THEN
    PERFORM extensions.http_post(
      url := supabase_url || '/functions/v1/shadow-evaluator',
      body := jsonb_build_object(
        'action', 'evaluate_new_prediction',
        'prediction_id', NEW.id,
        'project_id', NEW.project_id,
        'agent_name', NEW.agent_name,
        'match_status', NEW.match_status
      )::text,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_role_key
      )::jsonb
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shadow_prediction_auto_evaluate ON shadow_predictions;

CREATE TRIGGER trg_shadow_prediction_auto_evaluate
  AFTER INSERT ON shadow_predictions
  FOR EACH ROW
  WHEN (NEW.match_status = 'pending')
  EXECUTE FUNCTION notify_shadow_prediction_insert();
