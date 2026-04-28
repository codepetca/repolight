CREATE TABLE "classroom_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"repository_id" uuid,
	"student_id" uuid,
	"event_type" text NOT NULL,
	"external_id" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classroom_id" uuid NOT NULL,
	"analysis_run_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"template_repo_url" text,
	"repo_prefix" text,
	"repo_visibility" text DEFAULT 'private' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"rubric_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"repository_key" text NOT NULL,
	"repo_url" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"invitation_status" text DEFAULT 'manual' NOT NULL,
	"activity_status" text DEFAULT 'not_started' NOT NULL,
	"successful_push_count" integer DEFAULT 0 NOT NULL,
	"first_push_at" timestamp with time zone,
	"last_push_at" timestamp with time zone,
	"last_webhook_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classroom_id" uuid NOT NULL,
	"external_student_id" text,
	"name" text NOT NULL,
	"email" text,
	"github_login" text,
	"commit_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_name" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classrooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"term" text,
	"github_org" text,
	"default_repo_prefix" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classroom_activity_events" ADD CONSTRAINT "classroom_activity_events_assignment_id_classroom_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."classroom_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_activity_events" ADD CONSTRAINT "classroom_activity_events_repository_id_classroom_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."classroom_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_activity_events" ADD CONSTRAINT "classroom_activity_events_student_id_classroom_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."classroom_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_assignments" ADD CONSTRAINT "classroom_assignments_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_assignments" ADD CONSTRAINT "classroom_assignments_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_repositories" ADD CONSTRAINT "classroom_repositories_assignment_id_classroom_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."classroom_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_repositories" ADD CONSTRAINT "classroom_repositories_student_id_classroom_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."classroom_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_students" ADD CONSTRAINT "classroom_students_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_classroom_activity_event" ON "classroom_activity_events" USING btree ("assignment_id","event_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_classroom_repository_student" ON "classroom_repositories" USING btree ("assignment_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_classroom_repository_key" ON "classroom_repositories" USING btree ("assignment_id","repository_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_classroom_student_external" ON "classroom_students" USING btree ("classroom_id","external_student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_classroom_student_github" ON "classroom_students" USING btree ("classroom_id","github_login");