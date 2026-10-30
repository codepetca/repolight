-- Managed workspaces have no RepoLight user. Existing owner uniqueness remains intact.
ALTER TABLE public.rl_workspaces ALTER COLUMN owner_user_id DROP NOT NULL;--> statement-breakpoint
CREATE TABLE public.rl_managed_provisions (
 installation_ref text NOT NULL CONSTRAINT rl_managed_provisions_installation_ref_check CHECK (installation_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
 tenant_ref text NOT NULL CONSTRAINT rl_managed_provisions_tenant_ref_check CHECK (tenant_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
 operation_ref uuid NOT NULL,
 key_id uuid NOT NULL,
 current_key_id uuid NOT NULL,
 secret_hash text NOT NULL CONSTRAINT rl_managed_provisions_secret_hash_check CHECK (secret_hash ~ '^[a-f0-9]{64}$'),
 workspace_id uuid NOT NULL CONSTRAINT rl_managed_provisions_workspace_id_rl_workspaces_id_fk REFERENCES public.rl_workspaces(id) ON DELETE RESTRICT,
 CONSTRAINT rl_managed_provisions_installation_ref_tenant_ref_pk PRIMARY KEY (installation_ref, tenant_ref),
 CONSTRAINT rl_managed_provisions_installation_ref_operation_ref_unique UNIQUE (installation_ref, operation_ref), CONSTRAINT rl_managed_provisions_key_id_unique UNIQUE (key_id), CONSTRAINT rl_managed_provisions_workspace_id_unique UNIQUE (workspace_id),
 CONSTRAINT rl_managed_provisions_workspace_id_key_id_rl_api_keys_workspace_id_id_fk FOREIGN KEY (workspace_id, key_id) REFERENCES public.rl_api_keys(workspace_id, id) ON DELETE RESTRICT,
 CONSTRAINT rl_managed_current_key_fk FOREIGN KEY (workspace_id, current_key_id) REFERENCES public.rl_api_keys(workspace_id, id) ON DELETE RESTRICT
);--> statement-breakpoint
ALTER TABLE public.rl_managed_provisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public.rl_managed_provisions FROM PUBLIC;--> statement-breakpoint
CREATE TABLE public.rl_managed_rotations (
 installation_ref text NOT NULL,
 operation_ref uuid NOT NULL,
 tenant_ref text NOT NULL,
 expected_key_id uuid NOT NULL,
 key_id uuid NOT NULL CONSTRAINT rl_managed_rotations_key_id_unique UNIQUE,
 secret_hash text NOT NULL CONSTRAINT rl_managed_rotations_secret_hash_check CHECK (secret_hash ~ '^[a-f0-9]{64}$'),
 workspace_id uuid NOT NULL,
 CONSTRAINT rl_managed_rotations_installation_ref_operation_ref_pk PRIMARY KEY (installation_ref, operation_ref),
 CONSTRAINT rl_managed_rotations_installation_ref_tenant_ref_rl_managed_provisions_installation_ref_tenant_ref_fk FOREIGN KEY (installation_ref, tenant_ref) REFERENCES public.rl_managed_provisions(installation_ref, tenant_ref) ON DELETE RESTRICT,
 CONSTRAINT rl_managed_rotations_workspace_id_key_id_rl_api_keys_workspace_id_id_fk FOREIGN KEY (workspace_id, key_id) REFERENCES public.rl_api_keys(workspace_id, id) ON DELETE RESTRICT
);--> statement-breakpoint
ALTER TABLE public.rl_managed_rotations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public.rl_managed_rotations FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.rl_provision_managed(p_installation text,p_tenant text,p_operation uuid,p_key uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE v_existing public.rl_managed_provisions; v_workspace uuid; v_ref text;
BEGIN
 IF p_installation IS NULL OR p_installation !~ '^[A-Za-z0-9._~-]{1,128}$' OR p_tenant IS NULL OR p_tenant !~ '^[A-Za-z0-9._~-]{1,128}$' OR p_operation IS NULL OR p_key IS NULL OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'invalid managed provision';
 END IF;
 -- Serialize provisioning to make all competing operation, tenant and key conflicts deterministic.
 PERFORM pg_advisory_xact_lock(719443128204::bigint);
 SELECT * INTO v_existing FROM public.rl_managed_provisions WHERE installation_ref=p_installation AND tenant_ref=p_tenant;
 IF FOUND THEN
  IF v_existing.operation_ref=p_operation AND v_existing.key_id=p_key AND v_existing.secret_hash=p_hash THEN
   SELECT customer_ref INTO v_ref FROM public.rl_workspaces WHERE id=v_existing.workspace_id;
   RETURN jsonb_build_object('kind','replayed','workspaceRef',v_ref);
  END IF;
  RETURN jsonb_build_object('kind','conflict');
 END IF;
 IF EXISTS(SELECT 1 FROM public.rl_managed_provisions WHERE installation_ref=p_installation AND operation_ref=p_operation)
    OR EXISTS(SELECT 1 FROM public.rl_managed_rotations WHERE installation_ref=p_installation AND operation_ref=p_operation)
    OR EXISTS(SELECT 1 FROM public.rl_api_keys WHERE id=p_key) THEN
  RETURN jsonb_build_object('kind','conflict');
 END IF;
 v_workspace := gen_random_uuid(); v_ref := 'customer_' || gen_random_uuid()::text;
 INSERT INTO public.rl_workspaces(id,owner_user_id,customer_ref) VALUES(v_workspace,NULL,v_ref);
 INSERT INTO public.rl_api_keys(id,workspace_id,label,secret_hash,scopes,installation_ref)
 VALUES(p_key,v_workspace,'Managed Pika key',p_hash,'["analyses:create","analyses:read","analyses:erase"]'::jsonb,p_installation);
 INSERT INTO public.rl_managed_provisions(installation_ref,tenant_ref,operation_ref,key_id,current_key_id,secret_hash,workspace_id)
 VALUES(p_installation,p_tenant,p_operation,p_key,p_key,p_hash,v_workspace);
 RETURN jsonb_build_object('kind','created','workspaceRef',v_ref);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rl_provision_managed(text,text,uuid,uuid,text) FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.rl_rotate_managed(p_installation text,p_tenant text,p_operation uuid,p_expected uuid,p_key uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE v_existing public.rl_managed_rotations; v_provision public.rl_managed_provisions; v_ref text;
BEGIN
 IF p_installation IS NULL OR p_installation !~ '^[A-Za-z0-9._~-]{1,128}$' OR p_tenant IS NULL OR p_tenant !~ '^[A-Za-z0-9._~-]{1,128}$' OR p_operation IS NULL OR p_expected IS NULL OR p_key IS NULL OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'invalid managed rotation';
 END IF;
 PERFORM pg_advisory_xact_lock(719443128204::bigint);
 SELECT * INTO v_existing FROM public.rl_managed_rotations WHERE installation_ref=p_installation AND operation_ref=p_operation;
 IF FOUND THEN
  IF v_existing.tenant_ref=p_tenant AND v_existing.expected_key_id=p_expected AND v_existing.key_id=p_key AND v_existing.secret_hash=p_hash THEN
   SELECT customer_ref INTO v_ref FROM public.rl_workspaces WHERE id=v_existing.workspace_id;
   RETURN jsonb_build_object('kind','replayed','workspaceRef',v_ref);
  END IF;
  RETURN jsonb_build_object('kind','conflict');
 END IF;
 SELECT * INTO v_provision FROM public.rl_managed_provisions WHERE installation_ref=p_installation AND tenant_ref=p_tenant FOR UPDATE;
 IF NOT FOUND OR v_provision.current_key_id<>p_expected OR EXISTS(SELECT 1 FROM public.rl_managed_provisions WHERE installation_ref=p_installation AND operation_ref=p_operation)
    OR EXISTS(SELECT 1 FROM public.rl_api_keys WHERE id=p_key) THEN
  RETURN jsonb_build_object('kind','conflict');
 END IF;
 -- Hold the workspace lock before revoking, consistent with enqueue/erasure lock order.
 PERFORM 1 FROM public.rl_workspaces WHERE id=v_provision.workspace_id FOR UPDATE;
 UPDATE public.rl_api_keys SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=p_expected AND workspace_id=v_provision.workspace_id;
 INSERT INTO public.rl_api_keys(id,workspace_id,label,secret_hash,scopes,installation_ref)
 VALUES(p_key,v_provision.workspace_id,'Managed Pika key',p_hash,'["analyses:create","analyses:read","analyses:erase"]'::jsonb,p_installation);
 INSERT INTO public.rl_managed_rotations(installation_ref,operation_ref,tenant_ref,expected_key_id,key_id,secret_hash,workspace_id)
 VALUES(p_installation,p_operation,p_tenant,p_expected,p_key,p_hash,v_provision.workspace_id);
 UPDATE public.rl_managed_provisions SET current_key_id=p_key WHERE installation_ref=p_installation AND tenant_ref=p_tenant;
 SELECT customer_ref INTO v_ref FROM public.rl_workspaces WHERE id=v_provision.workspace_id;
 RETURN jsonb_build_object('kind','created','workspaceRef',v_ref);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rl_rotate_managed(text,text,uuid,uuid,uuid,text) FROM PUBLIC;
