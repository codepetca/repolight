CREATE TABLE "rl_subject_erasures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operation_ref" uuid NOT NULL,
	"installation_ref" text NOT NULL,
	"subject_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rl_erasure_installation" CHECK ("rl_subject_erasures"."installation_ref" ~ '^[A-Za-z0-9._~-]{1,128}$'),
	CONSTRAINT "rl_erasure_subject" CHECK ("rl_subject_erasures"."subject_ref" ~ '^[A-Za-z0-9._~-]{1,128}$')
);
--> statement-breakpoint
ALTER TABLE "rl_subject_erasures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rl_api_keys" DROP CONSTRAINT "rl_key_scopes";--> statement-breakpoint
ALTER TABLE "rl_subject_erasures" ADD CONSTRAINT "rl_subject_erasures_workspace_id_rl_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."rl_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rl_erasure_operation_unique" ON "rl_subject_erasures" USING btree ("workspace_id","operation_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "rl_erasure_subject_unique" ON "rl_subject_erasures" USING btree ("workspace_id","installation_ref","subject_ref");--> statement-breakpoint
ALTER TABLE "rl_api_keys" ADD CONSTRAINT "rl_key_scopes" CHECK (jsonb_typeof("rl_api_keys"."scopes") = 'array' and jsonb_array_length("rl_api_keys"."scopes") between 1 and 3 and "rl_api_keys"."scopes" <@ '["analyses:create","analyses:read","analyses:erase"]'::jsonb);
--> statement-breakpoint
REVOKE ALL ON public.rl_subject_erasures FROM PUBLIC;
--> statement-breakpoint
-- Admission already locks workspace first. Erasure takes exactly that same first lock.
-- Worker completion locks a job then (optionally) its key; reports reference that job,
-- not the workspace, so report insertion does not reverse the workspace/job order.
CREATE FUNCTION public.rl_erase_subject(p_workspace uuid,p_key uuid,p_operation uuid,p_installation text,p_subject text) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_existing public.rl_subject_erasures; v_key public.rl_api_keys; v_receipt jsonb;
BEGIN
 PERFORM 1 FROM public.rl_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','unauthorized'); END IF;
 IF p_key IS NOT NULL THEN
  SELECT * INTO v_key FROM public.rl_api_keys WHERE id=p_key AND workspace_id=p_workspace FOR SHARE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL OR (v_key.expires_at IS NOT NULL AND v_key.expires_at<=clock_timestamp())
   OR NOT (v_key.scopes ? 'analyses:erase') OR v_key.installation_ref IS DISTINCT FROM p_installation
  THEN RETURN jsonb_build_object('kind','unauthorized'); END IF;
 END IF;
 IF p_operation IS NULL OR p_installation IS NULL OR p_installation !~ '^[A-Za-z0-9._~-]{1,128}$' OR p_subject IS NULL OR p_subject !~ '^[A-Za-z0-9._~-]{1,128}$' THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 SELECT * INTO v_existing FROM public.rl_subject_erasures WHERE workspace_id=p_workspace AND operation_ref=p_operation;
 IF FOUND AND (v_existing.installation_ref IS DISTINCT FROM p_installation OR v_existing.subject_ref IS DISTINCT FROM p_subject) THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.rl_subject_erasures WHERE workspace_id=p_workspace AND installation_ref=p_installation AND subject_ref=p_subject) THEN RETURN jsonb_build_object('kind','conflict'); END IF;
  INSERT INTO public.rl_subject_erasures(workspace_id,operation_ref,installation_ref,subject_ref) VALUES(p_workspace,p_operation,p_installation,p_subject);
 END IF;
 -- Exact replays repeat the absence check under the same serialization lock.
 DELETE FROM public.rl_analysis_jobs WHERE workspace_id=p_workspace AND client_binding->>'installationRef'=p_installation AND client_binding->>'subjectRef'=p_subject;
 IF EXISTS(SELECT 1 FROM public.rl_analysis_jobs WHERE workspace_id=p_workspace AND client_binding->>'installationRef'=p_installation AND client_binding->>'subjectRef'=p_subject) THEN RAISE EXCEPTION 'erasure_absence_failed'; END IF;
 v_receipt := jsonb_build_object('schemaVersion','1.0','operationRef',p_operation,'installationRef',p_installation,'subjectRef',p_subject,'status','erased','absenceVerified',true);
 RETURN jsonb_build_object('kind','erased','receipt',v_receipt);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rl_erase_subject(uuid,uuid,uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.rl_enqueue_analysis(p_workspace uuid, p_key uuid, p_idempotency text, p_request jsonb, p_fingerprint text, p_binding jsonb,
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
 IF EXISTS(SELECT 1 FROM public.rl_subject_erasures WHERE workspace_id=p_workspace AND installation_ref=p_binding->>'installationRef' AND subject_ref=p_binding->>'subjectRef') THEN RETURN jsonb_build_object('kind','subject_erased'); END IF;
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
