CREATE TABLE "rl_interpretation_admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rl_interpretation_admissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rl_interpretations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"model" text NOT NULL,
	"report_digest" text NOT NULL,
	"input_digest" text NOT NULL,
	"input_json" jsonb NOT NULL,
	"citations_json" jsonb NOT NULL,
	"state" text DEFAULT 'generating' NOT NULL,
	"lease_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"sidecar_json" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "rl_interpretation_state" CHECK ("rl_interpretations"."state" in ('generating','available','failed')),
	CONSTRAINT "rl_interpretation_input_size" CHECK (octet_length("rl_interpretations"."input_json"::text)<=16384 and octet_length("rl_interpretations"."citations_json"::text)<=16384),
	CONSTRAINT "rl_interpretation_output_size" CHECK ("rl_interpretations"."sidecar_json" is null or octet_length("rl_interpretations"."sidecar_json"::text)<=32768)
);
--> statement-breakpoint
ALTER TABLE "rl_interpretations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rl_interpretation_admissions" ADD CONSTRAINT "rl_interpretation_admissions_workspace_id_rl_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."rl_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rl_interpretations" ADD CONSTRAINT "rl_interpretations_workspace_id_rl_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."rl_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rl_interpretations" ADD CONSTRAINT "rl_interpretation_workspace_job" FOREIGN KEY ("workspace_id","job_id") REFERENCES "public"."rl_analysis_jobs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rl_interpretation_admission_window" ON "rl_interpretation_admissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rl_interpretation_workspace_window" ON "rl_interpretation_admissions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rl_interpretation_request_unique" ON "rl_interpretations" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE INDEX "rl_interpretation_latest" ON "rl_interpretations" USING btree ("workspace_id","job_id","scope_key","created_at");
--> statement-breakpoint
REVOKE ALL ON public.rl_interpretations, public.rl_interpretation_admissions FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.rl_recover_interpretations(p_workspace uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.rl_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.rl_interpretations SET state='failed',error_code='expired',completed_at=clock_timestamp() WHERE workspace_id=p_workspace AND state='generating' AND lease_expires_at<=clock_timestamp();
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rl_recover_interpretations(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.rl_reserve_interpretation(p_workspace uuid,p_job uuid,p_request uuid,p_scope text,p_model text,p_report_digest text,p_input_digest text,p_input jsonb,p_citations jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_existing public.rl_interpretations; v_row public.rl_interpretations;
BEGIN
 -- Same first lock as erasure; never lock/recover another workspace's rows.
 PERFORM 1 FROM public.rl_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','not_found'); END IF;
 UPDATE public.rl_interpretations SET state='failed',error_code='expired',completed_at=clock_timestamp() WHERE workspace_id=p_workspace AND state='generating' AND lease_expires_at<=clock_timestamp();
 SELECT * INTO v_existing FROM public.rl_interpretations WHERE workspace_id=p_workspace AND request_id=p_request;
 IF FOUND THEN
  IF v_existing.job_id<>p_job OR v_existing.scope_key<>p_scope THEN RETURN jsonb_build_object('kind','conflict'); END IF;
  RETURN jsonb_build_object('kind','replayed','row',to_jsonb(v_existing));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rl_analysis_jobs j JOIN public.rl_reports r ON r.job_id=j.id AND r.workspace_id=j.workspace_id WHERE j.id=p_job AND j.workspace_id=p_workspace AND j.status='succeeded' AND r.report_digest=p_report_digest
 AND (p_scope='repository' OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.bundle_json->'contributors') entry WHERE 'contributor:'||(entry#>>'{contributor,id}')=p_scope))) THEN RETURN jsonb_build_object('kind','not_found'); END IF;
 IF p_model !~ '^[A-Za-z0-9_.:-]{1,100}$' OR p_input_digest !~ '^[a-f0-9]{64}$' OR p_report_digest !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('kind','conflict'); END IF;
 -- All workspaces use this global mutex only after their own workspace lock.
 PERFORM pg_advisory_xact_lock(7839014524::bigint);
 DELETE FROM public.rl_interpretation_admissions WHERE created_at<=clock_timestamp()-interval '24 hours';
 IF (SELECT count(*) FROM public.rl_interpretation_admissions)>=100
 OR (SELECT count(*) FROM public.rl_interpretation_admissions WHERE workspace_id=p_workspace)>=10
 OR (SELECT count(*) FROM public.rl_interpretations WHERE state='generating' AND lease_expires_at>clock_timestamp())>=2
 OR EXISTS(SELECT 1 FROM public.rl_interpretations WHERE workspace_id=p_workspace AND state='generating' AND lease_expires_at>clock_timestamp()) THEN RETURN jsonb_build_object('kind','limited'); END IF;
 INSERT INTO public.rl_interpretations(workspace_id,job_id,request_id,scope_key,model,report_digest,input_digest,input_json,citations_json,lease_expires_at)
 VALUES(p_workspace,p_job,p_request,p_scope,p_model,p_report_digest,p_input_digest,p_input,p_citations,clock_timestamp()+interval '60 seconds') RETURNING * INTO v_row;
 INSERT INTO public.rl_interpretation_admissions(workspace_id) VALUES(p_workspace);
 RETURN jsonb_build_object('kind','admitted','row',to_jsonb(v_row));
END $$;
--> statement-breakpoint
CREATE FUNCTION public.rl_finish_interpretation(p_workspace uuid,p_id uuid,p_token uuid,p_sidecar jsonb,p_error text) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_row public.rl_interpretations;
BEGIN
 PERFORM 1 FROM public.rl_workspaces WHERE id=p_workspace FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO v_row FROM public.rl_interpretations WHERE id=p_id AND workspace_id=p_workspace FOR UPDATE;
 IF NOT FOUND OR v_row.state<>'generating' OR v_row.lease_token<>p_token OR v_row.lease_expires_at<=clock_timestamp() THEN RETURN false; END IF;
 IF p_sidecar IS NOT NULL THEN
  IF p_error IS NOT NULL OR p_sidecar#>>'{provenance,inputDigest}' IS DISTINCT FROM v_row.input_digest OR p_sidecar#>>'{provenance,reportDigest}' IS DISTINCT FROM v_row.report_digest OR p_sidecar#>>'{provenance,model}' IS DISTINCT FROM v_row.model OR p_sidecar#>>'{provenance,scopeKey}' IS DISTINCT FROM v_row.scope_key OR p_sidecar#>>'{provenance,provider}' IS DISTINCT FROM 'openai' OR p_sidecar#>>'{provenance,promptVersion}' IS DISTINCT FROM '1.0.0' OR p_sidecar->>'schemaVersion' IS DISTINCT FROM '1.0' OR p_sidecar->'citations' IS DISTINCT FROM v_row.citations_json THEN RETURN false; END IF;
 ELSE
  IF p_error IS NULL OR p_error NOT IN ('configuration_unavailable','provider_timeout','provider_unavailable','provider_refused','provider_incomplete','invalid_output','expired','internal_failure') THEN RETURN false; END IF;
 END IF;
 UPDATE public.rl_interpretations SET state=CASE WHEN p_sidecar IS NULL THEN 'failed' ELSE 'available' END,sidecar_json=p_sidecar,error_code=p_error,completed_at=clock_timestamp() WHERE id=p_id;
 RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rl_reserve_interpretation(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb), public.rl_finish_interpretation(uuid,uuid,uuid,jsonb,text) FROM PUBLIC;

--> statement-breakpoint
CREATE FUNCTION public.rl_guard_interpretation_inputs() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF ROW(NEW.workspace_id,NEW.job_id,NEW.request_id,NEW.scope_key,NEW.model,NEW.report_digest,NEW.input_digest,NEW.input_json,NEW.citations_json,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.workspace_id,OLD.job_id,OLD.request_id,OLD.scope_key,OLD.model,OLD.report_digest,OLD.input_digest,OLD.input_json,OLD.citations_json,OLD.created_at)
 OR (OLD.state<>'generating' AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'immutable_interpretation_input' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rl_interpretation_immutable BEFORE UPDATE ON public.rl_interpretations FOR EACH ROW EXECUTE FUNCTION public.rl_guard_interpretation_inputs();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rl_guard_interpretation_inputs() FROM PUBLIC;
