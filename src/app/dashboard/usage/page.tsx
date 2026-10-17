import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { UsageDashboard } from "@/components/dashboard/usage-dashboard";
import { requireUser } from "@/lib/dashboard/data";

export const metadata: Metadata = { title: "Usage analytics" };
export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const { isAdmin } = await requireUser();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Observability"
        title="Usage analytics"
        description="Request counts, error rates and latencies from real gateway traffic. If there is no traffic, these views stay empty — no synthetic baseline."
      />
      <UsageDashboard isAdmin={isAdmin} />
    </div>
  );
}
