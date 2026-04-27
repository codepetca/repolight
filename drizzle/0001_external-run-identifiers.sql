ALTER TABLE "analysis_runs" ADD COLUMN "external_system" text;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "external_run_key" text;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "external_assignment_id" text;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "external_classroom_id" text;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "external_metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_analysis_run_external_key" ON "analysis_runs" USING btree ("user_id","external_system","external_run_key");