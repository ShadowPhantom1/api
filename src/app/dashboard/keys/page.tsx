import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { KeysManager, type KeyItem } from "@/components/dashboard/keys-manager";
import { getKeysForUser, requireUser } from "@/lib/dashboard/data";
import { serializePlatformKey } from "@/lib/api/serialize";

export const metadata: Metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const { admin, user } = await requireUser();
  const records = await getKeysForUser(admin, user.id);
  const keys = records
    .map(serializePlatformKey)
    .map((key) => key as unknown as KeyItem);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Gateway"
        title="Platform API keys"
        description="Keys authenticate REST gateway and OpenAI-compatible requests. Secrets are generated with CSPRNG, stored only as HMAC digests, and shown exactly once."
      />
      <Card>
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
          <CardDescription>
            Revocation is immediate. Rotation issues a new secret and revokes the previous key in one step.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KeysManager keys={keys} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Security notes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <p>· Upstream provider credentials are encrypted with AES-256-GCM before storage.</p>
          <p>· The Supabase service-role key is only used in server route handlers.</p>
          <p>· Request telemetry excludes query values, headers and bodies.</p>
          <p>· Scope checks run on every gateway request; revoked keys fail closed.</p>
        </CardContent>
      </Card>
    </div>
  );
}
