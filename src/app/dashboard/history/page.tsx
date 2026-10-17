import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { HistoryTable } from "@/components/dashboard/history-table";
import { requireUser } from "@/lib/dashboard/data";

export const metadata: Metadata = { title: "Request history" };
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const { isAdmin } = await requireUser();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Observability"
        title="Request history"
        description="Every gateway execution writes a metadata-only row: status, duration, bytes, error code and the endpoint. Secrets and payloads are never logged."
      />
      <HistoryTable isAdmin={isAdmin} />
    </div>
  );
}
