import {
  CORS,
  createAdminGenerationClient,
  env,
  jsonResponse,
  type BackendClient,
} from './_shared.ts';
import { runAnalyzeStage } from './analyze.ts';
import { runDesignerStage } from './designer.ts';
import { runHeroStage } from './hero.ts';
import {
  nextWorkerStage,
  responseFailure,
  thrownFailure,
  type WorkerFailure,
  type WorkerStage,
} from './_workerPolicy.ts';

interface ClaimedJob {
  id: string;
  generation_id: string;
  campaign_id: string;
  user_id: string;
  status: 'running';
  stage: WorkerStage;
  color_scheme: 'light' | 'dark';
  attempt_count: number;
  max_attempts: number;
}

interface GenerationState {
  id: string;
  status: string;
  scenario: string;
}

interface WorkerResult {
  job_id: string;
  stage: WorkerStage;
  result: 'advanced' | 'completed' | 'retrying' | 'failed' | 'lease_recovery';
  detail?: string;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'method' }, 405);

  const expected = `Bearer ${env('API_KEY')}`;
  if (req.headers.get('Authorization') !== expected) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const client = createAdminGenerationClient();
  const workerId = `generation-worker:${crypto.randomUUID()}`;
  const { data, error } = await client.database.rpc('claim_generation_jobs', {
    p_worker_id: workerId,
    p_limit: 2,
    p_lease_seconds: 300,
  });
  if (error) {
    return jsonResponse({ error: error.message, code: 'job_claim_failed' }, 500);
  }

  const jobs = rpcRows<ClaimedJob>(data);
  const results = await Promise.all(
    jobs.map((job) =>
      processClaimedJob(client, workerId, job).catch((stageError) =>
        recordFailure(client, workerId, job, thrownFailure(stageError))
      )
    ),
  );
  return jsonResponse({ claimed: jobs.length, results });
}

async function processClaimedJob(
  client: BackendClient,
  workerId: string,
  job: ClaimedJob,
): Promise<WorkerResult> {
  const generation = await loadGeneration(client, job);
  if (!generation) {
    return recordFailure(client, workerId, job, {
      code: 'generation_not_found',
      message: 'The queued poster generation no longer exists.',
      retryable: false,
    });
  }

  if (generation.status === 'failed') {
    return recordFailure(client, workerId, job, {
      code: 'generation_already_failed',
      message: 'The poster generation was already terminal.',
      retryable: false,
    });
  }

  const traceStatus = await loadTraceStatus(client, job);
  if (generation.status === 'ready') {
    await reconcileReadyTrace(client, job, traceStatus);
    return advance(client, workerId, job, null);
  }
  if (traceStatus === 'succeeded' || traceStatus === 'skipped') {
    return advance(
      client,
      workerId,
      job,
      nextWorkerStage(job.stage, generation.scenario),
    );
  }
  if (traceStatus === 'failed') {
    return recordFailure(client, workerId, job, {
      code: 'stage_trace_already_failed',
      message: 'The stage trace was already terminal.',
      retryable: false,
    });
  }

  let response: Response;
  try {
    const context = {
      client,
      userId: job.user_id,
      campaignId: job.campaign_id,
      generationId: job.generation_id,
      finalizeFailure: false,
      serverOwned: true,
    };
    if (job.stage === 'analyze') {
      response = await runAnalyzeStage({
        ...context,
        colorScheme: job.color_scheme,
      });
    } else if (job.stage === 'designer') {
      response = await runDesignerStage(context);
    } else {
      response = await runHeroStage(context);
    }
  } catch (error) {
    return recordFailure(client, workerId, job, thrownFailure(error));
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    return recordFailure(
      client,
      workerId,
      job,
      responseFailure(response.status, payload),
    );
  }

  const refreshed = await loadGeneration(client, job);
  if (!refreshed) {
    return recordFailure(client, workerId, job, {
      code: 'generation_lost_after_stage',
      message: 'The poster generation disappeared after its stage completed.',
      retryable: false,
    });
  }

  return advance(
    client,
    workerId,
    job,
    nextWorkerStage(job.stage, refreshed.scenario),
  );
}

async function reconcileReadyTrace(
  client: BackendClient,
  job: ClaimedJob,
  traceStatus: string | null,
): Promise<void> {
  if (!traceStatus || ['succeeded', 'failed', 'skipped'].includes(traceStatus)) return;

  const scope = () => client.database
    .from('generation_stage_traces')
    .update(traceStatus === 'pending'
      ? { status: 'running', started_at: new Date().toISOString() }
      : { status: 'succeeded', completed_at: new Date().toISOString() })
    .eq('generation_id', job.generation_id)
    .eq('campaign_id', job.campaign_id)
    .eq('user_id', job.user_id)
    .eq('stage', job.stage);

  try {
    if (traceStatus === 'pending') {
      const { error } = await scope();
      if (error) throw new Error(error.message);
    }
    const { error } = await client.database
      .from('generation_stage_traces')
      .update({
        status: 'succeeded',
        completed_at: new Date().toISOString(),
        failure_code: null,
        failure_message: null,
        failure_metadata: {},
      })
      .eq('generation_id', job.generation_id)
      .eq('campaign_id', job.campaign_id)
      .eq('user_id', job.user_id)
      .eq('stage', job.stage);
    if (error) throw new Error(error.message);
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'generation_ready_trace_reconcile_failed',
      job_id: job.id,
      generation_id: job.generation_id,
      stage: job.stage,
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function loadGeneration(
  client: BackendClient,
  job: ClaimedJob,
): Promise<GenerationState | null> {
  const { data, error } = await client.database
    .from('poster_generations')
    .select('id, status, scenario')
    .eq('id', job.generation_id)
    .eq('campaign_id', job.campaign_id)
    .eq('user_id', job.user_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as GenerationState | null;
}

async function loadTraceStatus(
  client: BackendClient,
  job: ClaimedJob,
): Promise<string | null> {
  const { data, error } = await client.database
    .from('generation_stage_traces')
    .select('status')
    .eq('generation_id', job.generation_id)
    .eq('campaign_id', job.campaign_id)
    .eq('user_id', job.user_id)
    .eq('stage', job.stage)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof (data as { status?: unknown } | null)?.status === 'string'
    ? String((data as { status: string }).status)
    : null;
}

async function advance(
  client: BackendClient,
  workerId: string,
  job: ClaimedJob,
  nextStage: WorkerStage | null,
): Promise<WorkerResult> {
  const { error } = await client.database.rpc('advance_generation_job', {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_next_stage: nextStage,
  });
  if (error) {
    // Keep the lease intact. A later invocation reconciles the authoritative
    // generation and trace after this lease expires.
    return {
      job_id: job.id,
      stage: job.stage,
      result: 'lease_recovery',
      detail: error.message,
    };
  }
  return {
    job_id: job.id,
    stage: job.stage,
    result: nextStage ? 'advanced' : 'completed',
  };
}

async function recordFailure(
  client: BackendClient,
  workerId: string,
  job: ClaimedJob,
  failure: WorkerFailure,
): Promise<WorkerResult> {
  const { data, error } = await client.database.rpc('record_generation_job_failure', {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_error_code: failure.code,
    p_error_message: failure.message,
    p_retryable: failure.retryable,
  });
  if (error) {
    return {
      job_id: job.id,
      stage: job.stage,
      result: 'lease_recovery',
      detail: error.message,
    };
  }
  const updated = rpcRow<{ status?: string }>(data);
  return {
    job_id: job.id,
    stage: job.stage,
    result: updated?.status === 'retrying' ? 'retrying' : 'failed',
    detail: failure.message,
  };
}

function rpcRows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value && typeof value === 'object' ? [value as T] : [];
}

function rpcRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value && typeof value === 'object' ? value as T : null;
}
