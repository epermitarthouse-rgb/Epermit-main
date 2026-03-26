CREATE INDEX IF NOT EXISTS idx_agent_runs_filing_id ON agent_runs(filing_id);
CREATE INDEX IF NOT EXISTS idx_shadow_predictions_created_at ON shadow_predictions(created_at);
CREATE INDEX IF NOT EXISTS idx_parsed_comments_discipline ON parsed_comments(discipline);
