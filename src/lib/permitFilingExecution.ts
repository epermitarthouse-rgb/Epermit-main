import { supabase } from '@/lib/supabase';

export interface ExecutionInvokeResult {
  filing_id?: string;
  status?: string;
  current_step?: string;
  error?: string;
  requires_human_intervention?: boolean;
  can_retry?: boolean;
  resume_from?: string;
  application_id?: string | null;
  confirmation_number?: string | null;
  auth_completed?: boolean;
  form_filing_completed?: boolean;
  submission_completed?: boolean;
  monitor_started?: boolean;
}

export function parseExecutionInvokeResult(data: unknown): ExecutionInvokeResult | null {
  if (!data || typeof data !== 'object') return null;
  return data as ExecutionInvokeResult;
}

export function describeExecutionOutcome(result: ExecutionInvokeResult | null): {
  tone: 'success' | 'warning' | 'error';
  title: string;
  detail: string;
} {
  if (!result) {
    return {
      tone: 'error',
      title: 'Execution did not return a result',
      detail: 'The execution pipeline returned no payload. Check agent logs for details.',
    };
  }

  if (result.requires_human_intervention) {
    return {
      tone: 'warning',
      title: 'Human intervention required',
      detail: result.error || 'Portal authentication requires captcha, MFA, or manual login assistance.',
    };
  }

  if (result.status === 'submitted' || result.submission_completed) {
    const ref = result.confirmation_number || result.application_id;
    return {
      tone: 'success',
      title: 'Filing submitted to the portal',
      detail: ref ? `Confirmation: ${ref}` : 'Submission completed successfully.',
    };
  }

  if (result.status === 'failed' || result.error) {
    const step = result.current_step ? ` at ${result.current_step.replace(/_/g, ' ')}` : '';
    return {
      tone: 'error',
      title: 'Execution pipeline failed',
      detail: result.error ? `${result.error}${step}` : `Execution failed${step}.`,
    };
  }

  if (result.form_filing_completed && !result.submission_completed) {
    return {
      tone: 'warning',
      title: 'Form filing completed; submission did not finish',
      detail: result.error || 'Review the agent log before retrying submission.',
    };
  }

  return {
    tone: 'warning',
    title: 'Execution finished without submission',
    detail: result.error || `Pipeline status: ${result.status || 'unknown'}.`,
  };
}

export async function hasPortalCredentialsForFiling(
  userId: string,
  credentialId?: string | null,
): Promise<boolean> {
  if (credentialId) {
    const { data } = await supabase
      .from('portal_credentials')
      .select('id')
      .eq('id', credentialId)
      .eq('user_id', userId)
      .maybeSingle();
    return !!data;
  }

  const { data } = await supabase
    .from('portal_credentials')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  return !!data;
}
