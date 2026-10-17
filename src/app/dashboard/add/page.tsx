import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ApiForm } from "@/components/dashboard/api-form";
import { PageHeader } from "@/components/ui/page-header";
import { getCategoryOptions, requireUser } from "@/lib/dashboard/data";

export const metadata: Metadata = { title: "Add API" };
export const dynamic = "force-dynamic";

export default async function AddApiPage() {
  const { admin } = await requireUser();
  const categories = await getCategoryOptions(admin);

  return (
    <div className="space-y-6">
      <Link href="/dashboard/explore" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to catalog
      </Link>
      <PageHeader
        eyebrow="Register"
        title="Add an API"
        description="Paste a URL, declare parameters and credentials, probe it for real, then save. No code change or redeploy is required — the registry is the source of truth."
      />
      <ApiForm categories={categories} mode="create" />
    </div>
  );
}
