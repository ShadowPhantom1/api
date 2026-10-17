import { Badge } from "@/components/ui/badge";
import type { VerificationStatus } from "@/lib/db/types";

export function VerificationBadge({ status }: { status: VerificationStatus | string }) {
  if (status === "verified") return <Badge variant="success">Verified</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="secondary">Unverified</Badge>;
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? <Badge variant="info">Enabled</Badge> : <Badge variant="outline">Disabled</Badge>;
}

export function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
  return isPublic ? <Badge variant="default">Public</Badge> : <Badge variant="secondary">Private</Badge>;
}
