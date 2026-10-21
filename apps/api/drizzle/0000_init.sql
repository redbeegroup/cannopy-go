CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'cost_of_sales', 'expense');--> statement-breakpoint
CREATE TYPE "public"."accounting_mode" AS ENUM('cash', 'accrual');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'mode_switch');--> statement-breakpoint
CREATE TYPE "public"."business_type" AS ENUM('shop', 'food_and_drink', 'trader', 'service', 'online_seller', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('open', 'partly_paid', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('sale', 'purchase', 'expense', 'payment_in', 'payment_out', 'owner_in', 'owner_out', 'transfer', 'stock_adjustment', 'opening_balance');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('stocked', 'not_tracked', 'service');--> statement-breakpoint
CREATE TYPE "public"."journal_basis" AS ENUM('accrual', 'cash', 'both');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'my');--> statement-breakpoint
CREATE TYPE "public"."money_kind" AS ENUM('cash', 'bank', 'wallet');--> statement-breakpoint
CREATE TYPE "public"."owner_group" AS ENUM('my_money', 'owed_to_me', 'stock', 'things_i_own', 'i_owe', 'owner', 'money_in', 'money_out');--> statement-breakpoint
CREATE TYPE "public"."sync_entity" AS ENUM('account', 'contact', 'item', 'document', 'stock_movement', 'journal_entry');--> statement-breakpoint
CREATE TYPE "public"."sync_op" AS ENUM('upsert', 'delete');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'cashier');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"code" text NOT NULL,
	"type" "account_type" NOT NULL,
	"owner_group" "owner_group" NOT NULL,
	"name_en" text DEFAULT '' NOT NULL,
	"name_my" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"money_kind" "money_kind",
	"provider" text,
	"default_fee" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_en" text DEFAULT '' NOT NULL,
	"name_my" text DEFAULT '' NOT NULL,
	"type" "business_type" DEFAULT 'other' NOT NULL,
	"primary_language" "language" DEFAULT 'my' NOT NULL,
	"accounting_mode" "accounting_mode" DEFAULT 'cash' NOT NULL,
	"fiscal_year_start_month" smallint DEFAULT 4 NOT NULL,
	"currency" text DEFAULT 'MMK' NOT NULL,
	"tax_enabled" boolean DEFAULT false NOT NULL,
	"lock_date" date,
	"digit_grouping" text DEFAULT 'thousand' NOT NULL,
	"myanmar_digits" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"name_en" text DEFAULT '' NOT NULL,
	"name_my" text DEFAULT '' NOT NULL,
	"phone" text,
	"is_customer" boolean DEFAULT true NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"credit_limit" bigint,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"date" date NOT NULL,
	"number" integer,
	"contact_id" uuid,
	"money_account_id" uuid,
	"to_money_account_id" uuid,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total" bigint NOT NULL,
	"fee_amount" bigint DEFAULT 0 NOT NULL,
	"status" "document_status" DEFAULT 'open' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"attachment_url" text,
	"created_by_user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"name_en" text DEFAULT '' NOT NULL,
	"name_my" text DEFAULT '' NOT NULL,
	"type" "item_type" DEFAULT 'stocked' NOT NULL,
	"unit_en" text DEFAULT 'piece' NOT NULL,
	"unit_my" text DEFAULT '' NOT NULL,
	"selling_price" bigint,
	"average_cost" bigint DEFAULT 0 NOT NULL,
	"last_cost" bigint,
	"quantity_on_hand_milli" bigint DEFAULT 0 NOT NULL,
	"low_stock_level_milli" bigint,
	"barcode" text,
	"photo_url" text,
	"location_id" uuid,
	"lot_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"date" date NOT NULL,
	"basis" "journal_basis" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"entry_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"business_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"contact_id" uuid,
	"item_id" uuid,
	CONSTRAINT "journal_lines_entry_id_line_no_pk" PRIMARY KEY("entry_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"date" date NOT NULL,
	"quantity_milli" bigint NOT NULL,
	"unit_cost" bigint NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "sync_changes" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"entity" "sync_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" "sync_op" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mutation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_mutations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"entity" "sync_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" "sync_op" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"role" "user_role" DEFAULT 'owner' NOT NULL,
	"language" "language" DEFAULT 'my' NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_money_account_id_accounts_id_fk" FOREIGN KEY ("money_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_to_money_account_id_accounts_id_fk" FOREIGN KEY ("to_money_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_mutation_id_sync_mutations_id_fk" FOREIGN KEY ("mutation_id") REFERENCES "public"."sync_mutations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_business_code_unique" ON "accounts" USING btree ("business_id","code");--> statement-breakpoint
CREATE INDEX "accounts_business_seq_idx" ON "accounts" USING btree ("business_id","server_seq");--> statement-breakpoint
CREATE INDEX "audit_log_business_at_idx" ON "audit_log" USING btree ("business_id","at");--> statement-breakpoint
CREATE INDEX "contacts_business_seq_idx" ON "contacts" USING btree ("business_id","server_seq");--> statement-breakpoint
CREATE INDEX "documents_business_date_idx" ON "documents" USING btree ("business_id","date");--> statement-breakpoint
CREATE INDEX "documents_business_contact_idx" ON "documents" USING btree ("business_id","contact_id");--> statement-breakpoint
CREATE INDEX "documents_business_seq_idx" ON "documents" USING btree ("business_id","server_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_business_type_number_unique" ON "documents" USING btree ("business_id","type","number") WHERE number is not null;--> statement-breakpoint
CREATE INDEX "items_business_seq_idx" ON "items" USING btree ("business_id","server_seq");--> statement-breakpoint
CREATE INDEX "items_business_barcode_idx" ON "items" USING btree ("business_id","barcode");--> statement-breakpoint
CREATE INDEX "journal_entries_business_date_idx" ON "journal_entries" USING btree ("business_id","date");--> statement-breakpoint
CREATE INDEX "journal_entries_document_idx" ON "journal_entries" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "journal_entries_business_seq_idx" ON "journal_entries" USING btree ("business_id","server_seq");--> statement-breakpoint
CREATE INDEX "journal_lines_business_account_idx" ON "journal_lines" USING btree ("business_id","account_id");--> statement-breakpoint
CREATE INDEX "stock_movements_item_date_idx" ON "stock_movements" USING btree ("item_id","date");--> statement-breakpoint
CREATE INDEX "stock_movements_document_idx" ON "stock_movements" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "stock_movements_business_seq_idx" ON "stock_movements" USING btree ("business_id","server_seq");--> statement-breakpoint
CREATE INDEX "sync_changes_business_seq_idx" ON "sync_changes" USING btree ("business_id","seq");--> statement-breakpoint
CREATE INDEX "sync_mutations_business_idx" ON "sync_mutations" USING btree ("business_id","received_at");--> statement-breakpoint
CREATE INDEX "users_business_idx" ON "users" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE email is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone") WHERE phone is not null;