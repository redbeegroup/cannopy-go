CREATE TABLE "document_allocations" (
	"payment_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "document_allocations_payment_id_document_id_pk" PRIMARY KEY("payment_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "paid_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "stock_value" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "value" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "line_id" uuid;--> statement-breakpoint
ALTER TABLE "document_allocations" ADD CONSTRAINT "document_allocations_payment_id_documents_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_allocations" ADD CONSTRAINT "document_allocations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_allocations" ADD CONSTRAINT "document_allocations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_allocations_document_idx" ON "document_allocations" USING btree ("document_id");