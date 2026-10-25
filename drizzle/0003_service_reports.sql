CREATE TABLE "rl_analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by_key_id" uuid,
	"idempotency_key" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"request_fingerprint" text NOT NULL,
	"client_binding" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_generation" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"worker_id" text,
	"snapshot_json" jsonb,
	"report_ref" uuid,
	"error_code" text,
	"error_retryable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"deadline_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rl_job_workspace_identity" UNIQUE("workspace_id","id"),
	CONSTRAINT "rl_job_state" CHECK ("rl_analysis_jobs"."status" in ('queued','running','succeeded','failed')),
	CONSTRAINT "rl_job_attempts" CHECK ("rl_analysis_jobs"."max_attempts" between 1 and 3 and "rl_analysis_jobs"."attempt_count" between 0 and "rl_analysis_jobs"."max_attempts" and "rl_analysis_jobs"."lease_generation" >= 0),
	CONSTRAINT "rl_job_idempotency" CHECK (char_length("rl_analysis_jobs"."idempotency_key") between 1 and 128),
	CONSTRAINT "rl_job_fingerprint" CHECK ("rl_analysis_jobs"."request_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "rl_job_request_size" CHECK (jsonb_typeof("rl_analysis_jobs"."request_json") = 'object' and octet_length("rl_analysis_jobs"."request_json"::text) <= 65536),
	CONSTRAINT "rl_job_binding_size" CHECK ("rl_analysis_jobs"."client_binding" is null or (jsonb_typeof("rl_analysis_jobs"."client_binding") = 'object' and octet_length("rl_analysis_jobs"."client_binding"::text) <= 2048)),
	CONSTRAINT "rl_job_error_code" CHECK ("rl_analysis_jobs"."error_code" is null or "rl_analysis_jobs"."error_code" in ('repository_unavailable','private_repository','upstream_rate_limited','upstream_timeout','upstream_unavailable','collection_limit','invalid_evidence','result_too_large','internal_failure','credential_revoked','job_expired','attempts_exhausted')),
	CONSTRAINT "rl_job_lease_state" CHECK (("rl_analysis_jobs"."status" = 'running') = ("rl_analysis_jobs"."lease_token" is not null and "rl_analysis_jobs"."lease_expires_at" is not null and "rl_analysis_jobs"."worker_id" is not null)),
	CONSTRAINT "rl_job_terminal_state" CHECK (("rl_analysis_jobs"."status" in ('succeeded','failed')) = ("rl_analysis_jobs"."completed_at" is not null)),
	CONSTRAINT "rl_job_result_state" CHECK (("rl_analysis_jobs"."status" = 'succeeded') = ("rl_analysis_jobs"."report_ref" is not null))
);
--> statement-breakpoint
ALTER TABLE "rl_analysis_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rl_api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"installation_ref" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rl_key_workspace_identity" UNIQUE("workspace_id","id"),
	CONSTRAINT "rl_key_hash" CHECK ("rl_api_keys"."secret_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "rl_key_label" CHECK (char_length("rl_api_keys"."label") between 1 and 100),
	CONSTRAINT "rl_key_scopes" CHECK (jsonb_typeof("rl_api_keys"."scopes") = 'array' and jsonb_array_length("rl_api_keys"."scopes") between 1 and 2 and "rl_api_keys"."scopes" <@ '["analyses:create","analyses:read"]'::jsonb),
	CONSTRAINT "rl_key_installation" CHECK ("rl_api_keys"."installation_ref" is null or "rl_api_keys"."installation_ref" ~ '^[A-Za-z0-9._~-]{1,128}$')
);
--> statement-breakpoint
ALTER TABLE "rl_api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rl_feedback_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"report_ref" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"text" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rl_edit_revision" CHECK ("rl_feedback_edits"."revision" > 0),
	CONSTRAINT "rl_edit_text" CHECK ("rl_feedback_edits"."text" is null or char_length("rl_feedback_edits"."text") <= 20000),
	CONSTRAINT "rl_edit_scope" CHECK (char_length("rl_feedback_edits"."scope_key") between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "rl_feedback_edits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rl_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"bundle_json" jsonb NOT NULL,
	"report_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rl_report_workspace_identity" UNIQUE("workspace_id","id"),
	CONSTRAINT "rl_report_digest" CHECK ("rl_reports"."report_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "rl_report_bundle_size" CHECK (jsonb_typeof("rl_reports"."bundle_json") = 'object' and octet_length("rl_reports"."bundle_json"::text) <= 8388608)
);
--> statement-breakpoint
ALTER TABLE "rl_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rl_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"customer_ref" text NOT NULL,
	"admission_day" text DEFAULT '' NOT NULL,
	"admission_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rl_workspace_admission_nonnegative" CHECK ("rl_workspaces"."admission_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "rl_workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rl_analysis_jobs" ADD CONSTRAINT "rl_analysis_jobs_workspace_id_rl_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."rl_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rl_analysis_jobs" ADD CONSTRAINT "rl_job_workspace_key" FOREIGN KEY ("workspace_id","created_by_key_id") REFERENCES "public"."rl_api_keys"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rl_api_keys" ADD CONSTRAINT "rl_api_keys_workspace_id_rl_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."rl_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rl_feedback_edits" ADD CONSTRAINT "rl_feedback_edits_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rl_feedback_edits" ADD CONSTRAINT "rl_edit_workspace_report" FOREIGN KEY ("workspace_id","report_ref") REFERENCES "public"."rl_reports"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rl_reports" ADD CONSTRAINT "rl_report_workspace_job" FOREIGN KEY ("workspace_id","job_id") REFERENCES "public"."rl_analysis_jobs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rl_workspaces" ADD CONSTRAINT "rl_workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rl_job_idempotency_unique" ON "rl_analysis_jobs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "rl_job_claim" ON "rl_analysis_jobs" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "rl_key_workspace" ON "rl_api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rl_edit_scope_unique" ON "rl_feedback_edits" USING btree ("report_ref","scope_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rl_report_job_unique" ON "rl_reports" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rl_workspace_owner_unique" ON "rl_workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rl_workspace_customer_unique" ON "rl_workspaces" USING btree ("customer_ref");--> statement-breakpoint
-- Atomic service operations: callable through Neon HTTP without interactive transactions.
CREATE FUNCTION public.rl_guard_job_inputs() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF ROW(NEW.workspace_id, NEW.created_by_key_id, NEW.idempotency_key, NEW.request_json, NEW.request_fingerprint, NEW.client_binding, NEW.created_at, NEW.max_attempts, NEW.deadline_at)
    IS DISTINCT FROM ROW(OLD.workspace_id, OLD.created_by_key_id, OLD.idempotency_key, OLD.request_json, OLD.request_fingerprint, OLD.client_binding, OLD.created_at, OLD.max_attempts, OLD.deadline_at)
    OR (OLD.snapshot_json IS NOT NULL AND NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json)
    OR (OLD.status IN ('succeeded','failed') AND NEW IS DISTINCT FROM OLD)
  THEN RAISE EXCEPTION 'immutable_analysis_input' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rl_job_immutable_inputs BEFORE UPDATE ON public.rl_analysis_jobs FOR EACH ROW EXECUTE FUNCTION public.rl_guard_job_inputs();
--> statement-breakpoint
CREATE FUNCTION public.rl_guard_report_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'immutable_report' USING ERRCODE = '55000'; END $$;
--> statement-breakpoint
CREATE TRIGGER rl_report_immutable BEFORE UPDATE ON public.rl_reports FOR EACH ROW EXECUTE FUNCTION public.rl_guard_report_immutable();
--> statement-breakpoint
CREATE FUNCTION public.rl_enqueue_analysis(p_workspace uuid, p_key uuid, p_idempotency text, p_request jsonb, p_fingerprint text, p_binding jsonb,
 p_daily integer, p_queued integer, p_attempts integer, p_lifetime integer) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_workspace public.rl_workspaces; v_key public.rl_api_keys; v_job public.rl_analysis_jobs; v_day text := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD');
BEGIN
 SELECT * INTO v_workspace FROM public.rl_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','unauthorized'); END IF;
 IF p_key IS NOT NULL THEN
  SELECT * INTO v_key FROM public.rl_api_keys WHERE id=p_key AND workspace_id=p_workspace FOR SHARE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL OR (v_key.expires_at IS NOT NULL AND v_key.expires_at <= clock_timestamp()) OR NOT (v_key.scopes ? 'analyses:create')
   OR (v_key.installation_ref IS NOT NULL AND (p_binding->>'installationRef' IS DISTINCT FROM v_key.installation_ref))
  THEN RETURN jsonb_build_object('kind','unauthorized'); END IF;
 END IF;
 SELECT * INTO v_job FROM public.rl_analysis_jobs WHERE workspace_id=p_workspace AND idempotency_key=p_idempotency;
 IF FOUND THEN
  IF v_job.request_fingerprint <> p_fingerprint OR v_job.request_json <> p_request OR v_job.client_binding IS DISTINCT FROM p_binding THEN RETURN jsonb_build_object('kind','conflict'); END IF;
  RETURN jsonb_build_object('kind','replayed','job',to_jsonb(v_job));
 END IF;
 IF (CASE WHEN v_workspace.admission_day=v_day THEN v_workspace.admission_count ELSE 0 END) >= greatest(1,least(p_daily,1000)) THEN RETURN jsonb_build_object('kind','limited','reason','daily_limit'); END IF;
 IF (SELECT count(*) FROM public.rl_analysis_jobs WHERE workspace_id=p_workspace AND status='queued') >= greatest(1,least(p_queued,100)) THEN RETURN jsonb_build_object('kind','limited','reason','queue_limit'); END IF;
 INSERT INTO public.rl_analysis_jobs(workspace_id,created_by_key_id,idempotency_key,request_json,request_fingerprint,client_binding,max_attempts,deadline_at)
 VALUES(p_workspace,p_key,p_idempotency,p_request,p_fingerprint,p_binding,greatest(1,least(p_attempts,3)),clock_timestamp()+make_interval(secs=>greatest(60,least(p_lifetime,86400)))) RETURNING * INTO v_job;
 UPDATE public.rl_workspaces SET admission_day=v_day,admission_count=(CASE WHEN admission_day=v_day THEN admission_count ELSE 0 END)+1 WHERE id=p_workspace;
 RETURN jsonb_build_object('kind','accepted','job',to_jsonb(v_job));
END $$;
--> statement-breakpoint
CREATE FUNCTION public.rl_recover_jobs() RETURNS integer LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
 WITH expired AS (
 SELECT j.id, CASE
  WHEN j.deadline_at <= clock_timestamp() THEN 'job_expired'
  WHEN j.created_by_key_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rl_api_keys k WHERE k.id=j.created_by_key_id AND k.workspace_id=j.workspace_id AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>clock_timestamp())) THEN 'credential_revoked'
  WHEN j.attempt_count >= j.max_attempts THEN 'attempts_exhausted' ELSE NULL END AS terminal
 FROM public.rl_analysis_jobs j WHERE j.status IN ('queued','running') AND (
 j.deadline_at<=clock_timestamp() OR (j.status='running' AND j.lease_expires_at<=clock_timestamp()) OR
 (j.created_by_key_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rl_api_keys k WHERE k.id=j.created_by_key_id AND k.workspace_id=j.workspace_id AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>clock_timestamp())))
 ) FOR UPDATE OF j SKIP LOCKED)
 UPDATE public.rl_analysis_jobs j SET status=CASE WHEN e.terminal IS NULL THEN 'queued' ELSE 'failed' END,
 completed_at=CASE WHEN e.terminal IS NULL THEN NULL ELSE clock_timestamp() END,
 next_attempt_at=CASE WHEN e.terminal IS NULL THEN clock_timestamp()+interval '15 seconds' ELSE NULL END,
 error_code=coalesce(e.terminal,'upstream_unavailable'),error_retryable=(e.terminal IS NULL),lease_token=NULL,lease_expires_at=NULL,worker_id=NULL
 FROM expired e WHERE j.id=e.id;
 GET DIAGNOSTICS v_count = ROW_COUNT; RETURN v_count;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.rl_claim_analysis(p_worker text,p_lease integer,p_workspace_limit integer,p_global_limit integer) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.rl_analysis_jobs; v_key public.rl_api_keys;
BEGIN
 PERFORM pg_advisory_xact_lock(7839014521::bigint);
 PERFORM public.rl_recover_jobs();
 IF (SELECT count(*) FROM public.rl_analysis_jobs WHERE status='running' AND lease_expires_at>clock_timestamp()) >= greatest(1,least(p_global_limit,16)) THEN RETURN NULL; END IF;
 FOR v_job IN SELECT j.* FROM public.rl_analysis_jobs j WHERE j.status='queued' AND (j.next_attempt_at IS NULL OR j.next_attempt_at<=clock_timestamp()) AND j.deadline_at>clock_timestamp() AND j.attempt_count<j.max_attempts
 AND (SELECT count(*) FROM public.rl_analysis_jobs a WHERE a.workspace_id=j.workspace_id AND a.status='running' AND a.lease_expires_at>clock_timestamp()) < greatest(1,least(p_workspace_limit,4))
 ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LOOP
  IF v_job.created_by_key_id IS NOT NULL THEN
   SELECT * INTO v_key FROM public.rl_api_keys WHERE id=v_job.created_by_key_id AND workspace_id=v_job.workspace_id FOR SHARE;
   IF NOT FOUND OR v_key.revoked_at IS NOT NULL OR (v_key.expires_at IS NOT NULL AND v_key.expires_at<=clock_timestamp()) THEN CONTINUE; END IF;
  END IF;
  UPDATE public.rl_analysis_jobs SET status='running',attempt_count=attempt_count+1,lease_generation=lease_generation+1,lease_token=gen_random_uuid(),lease_expires_at=least(deadline_at,clock_timestamp()+make_interval(secs=>greatest(10,least(p_lease,300)))),worker_id=left(p_worker,128),next_attempt_at=NULL,error_code=NULL,error_retryable=false WHERE id=v_job.id RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
 END LOOP;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.rl_live_lease(p_job uuid,p_token uuid,p_generation integer) RETURNS boolean LANGUAGE sql SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.rl_analysis_jobs j WHERE id=p_job AND status='running' AND lease_token=p_token AND lease_generation=p_generation AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp()
 AND (created_by_key_id IS NULL OR EXISTS(SELECT 1 FROM public.rl_api_keys k WHERE k.id=j.created_by_key_id AND k.workspace_id=j.workspace_id AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>clock_timestamp()))))
$$;
--> statement-breakpoint
CREATE FUNCTION public.rl_renew_lease(p_job uuid,p_token uuid,p_generation integer,p_seconds integer) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.rl_analysis_jobs WHERE id=p_job FOR UPDATE;
 IF NOT public.rl_live_lease(p_job,p_token,p_generation) THEN RETURN false; END IF;
 UPDATE public.rl_analysis_jobs SET lease_expires_at=least(deadline_at,clock_timestamp()+make_interval(secs=>greatest(10,least(p_seconds,300)))) WHERE id=p_job; RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.rl_pin_snapshot(p_job uuid,p_token uuid,p_generation integer,p_snapshot jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.rl_analysis_jobs;
BEGIN
 SELECT * INTO v_job FROM public.rl_analysis_jobs WHERE id=p_job FOR UPDATE;
 IF NOT public.rl_live_lease(p_job,p_token,p_generation) THEN RETURN false; END IF;
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR NOT (p_snapshot ?& ARRAY['repositoryUrl','branch','sha','capturedAt','kind']) OR (SELECT count(*) FROM jsonb_object_keys(p_snapshot)) <> 5 OR p_snapshot->>'sha' !~ '^[a-f0-9]{40}$' OR p_snapshot->>'kind' <> 'analysis_time' OR p_snapshot->>'repositoryUrl' IS DISTINCT FROM v_job.request_json->>'repositoryUrl' OR coalesce(length(p_snapshot->>'branch'),0) NOT BETWEEN 1 AND 200
 OR (v_job.request_json ? 'branch' AND p_snapshot->>'branch' IS DISTINCT FROM v_job.request_json->>'branch') OR NOT (p_snapshot ? 'capturedAt') THEN RETURN false; END IF;
 IF v_job.snapshot_json IS NOT NULL THEN RETURN v_job.snapshot_json=p_snapshot; END IF;
 UPDATE public.rl_analysis_jobs SET snapshot_json=p_snapshot WHERE id=p_job; RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.rl_complete_analysis(p_job uuid,p_token uuid,p_generation integer,p_bundle jsonb,p_digest text) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.rl_analysis_jobs; v_key public.rl_api_keys;
BEGIN
 SELECT * INTO v_job FROM public.rl_analysis_jobs WHERE id=p_job FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF v_job.created_by_key_id IS NOT NULL THEN
  SELECT * INTO v_key FROM public.rl_api_keys WHERE id=v_job.created_by_key_id AND workspace_id=v_job.workspace_id FOR SHARE;
 END IF;
 IF NOT public.rl_live_lease(p_job,p_token,p_generation) OR v_job.snapshot_json IS NULL THEN RETURN false; END IF;
 IF p_bundle->>'bundleRef' IS DISTINCT FROM p_job::text OR p_bundle->>'schemaVersion' IS DISTINCT FROM '1.0' OR p_bundle#>>'{context,snapshot,sha}' IS DISTINCT FROM v_job.snapshot_json->>'sha'
 OR p_bundle#>>'{context,snapshot,capturedAt}' IS DISTINCT FROM v_job.snapshot_json->>'capturedAt' OR p_bundle#>>'{context,repository,url}' IS DISTINCT FROM v_job.snapshot_json->>'repositoryUrl' OR p_bundle#>>'{context,repository,branch}' IS DISTINCT FROM v_job.snapshot_json->>'branch' THEN RETURN false; END IF;
 INSERT INTO public.rl_reports(id,workspace_id,job_id,bundle_json,report_digest) VALUES(p_job,v_job.workspace_id,p_job,p_bundle,p_digest);
 UPDATE public.rl_analysis_jobs SET status='succeeded',report_ref=p_job,completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,worker_id=NULL,error_code=NULL,error_retryable=false WHERE id=p_job;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.rl_fail_analysis(p_job uuid,p_token uuid,p_generation integer,p_code text,p_retryable boolean,p_delay integer) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.rl_analysis_jobs; v_retry boolean;
BEGIN
 SELECT * INTO v_job FROM public.rl_analysis_jobs WHERE id=p_job FOR UPDATE;
 IF NOT public.rl_live_lease(p_job,p_token,p_generation) THEN RETURN false; END IF;
 v_retry := p_retryable AND v_job.attempt_count<v_job.max_attempts AND v_job.deadline_at>clock_timestamp()+make_interval(secs=>greatest(1,least(p_delay,3600)));
 UPDATE public.rl_analysis_jobs SET status=CASE WHEN v_retry THEN 'queued' ELSE 'failed' END,
 error_code=p_code,error_retryable=v_retry,next_attempt_at=CASE WHEN v_retry THEN clock_timestamp()+make_interval(secs=>greatest(1,least(p_delay,3600))) ELSE NULL END,
 completed_at=CASE WHEN v_retry THEN NULL ELSE clock_timestamp() END,lease_token=NULL,lease_expires_at=NULL,worker_id=NULL WHERE id=p_job;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.rl_save_edit(p_workspace uuid,p_report uuid,p_actor uuid,p_scope text,p_revision integer,p_text text) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_report public.rl_reports; v_edit public.rl_feedback_edits;
BEGIN
 PERFORM 1 FROM public.rl_workspaces WHERE id=p_workspace AND owner_user_id=p_actor FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','not_found'); END IF;
 SELECT * INTO v_report FROM public.rl_reports WHERE id=p_report AND workspace_id=p_workspace FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','not_found'); END IF;
 IF p_scope <> 'repository' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_report.bundle_json->'contributors') entry WHERE 'contributor:'||(entry#>>'{contributor,id}')=p_scope)
 THEN RETURN jsonb_build_object('kind','invalid_scope'); END IF;
 IF p_revision<0 THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 IF p_revision=0 THEN
  INSERT INTO public.rl_feedback_edits(workspace_id,report_ref,scope_key,text,actor_user_id) VALUES(p_workspace,p_report,p_scope,p_text,p_actor) ON CONFLICT(report_ref,scope_key) DO NOTHING RETURNING * INTO v_edit;
 ELSE
  UPDATE public.rl_feedback_edits SET text=p_text,revision=revision+1,actor_user_id=p_actor,updated_at=clock_timestamp() WHERE workspace_id=p_workspace AND report_ref=p_report AND scope_key=p_scope AND revision=p_revision RETURNING * INTO v_edit;
 END IF;
 IF v_edit.id IS NULL THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 RETURN jsonb_build_object('kind','saved','edit',to_jsonb(v_edit));
END $$;
--> statement-breakpoint
-- Functions are an application-server boundary, not anonymous database APIs.
REVOKE ALL ON FUNCTION public.rl_guard_job_inputs(),public.rl_guard_report_immutable(),public.rl_enqueue_analysis(uuid,uuid,text,jsonb,text,jsonb,integer,integer,integer,integer),public.rl_recover_jobs(),public.rl_claim_analysis(text,integer,integer,integer),public.rl_live_lease(uuid,uuid,integer),public.rl_renew_lease(uuid,uuid,integer,integer),public.rl_pin_snapshot(uuid,uuid,integer,jsonb),public.rl_complete_analysis(uuid,uuid,integer,jsonb,text),public.rl_fail_analysis(uuid,uuid,integer,text,boolean,integer),public.rl_save_edit(uuid,uuid,uuid,text,integer,text) FROM PUBLIC;
