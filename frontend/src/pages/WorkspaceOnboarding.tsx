import { useState } from 'react';
import { NOT_A_CREDENTIAL } from '@/lib/form-attributes';
import { useNavigate, Link } from 'react-router-dom';
import { authClient, useSession } from '@/lib/auth-client';
import { useInvalidateUserMetrics } from '@/features/user/queries';
import { useKeyContext } from '@/context/KeyContext';
import { provisionWorkspaceKeys } from '@/lib/keys';
import { createWorkspace } from '@/features/workspaces/api';
import { useAccess } from '@/hooks/useAccess';
import { PublicHeader } from '@/components/PublicHeader';
import { PublicFooter } from '@/components/PublicFooter';
import { errorMessage } from '@/lib/errors';
import { nameProblem, thingName } from '@/lib/names';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

export function WorkspaceOnboarding() {
  const [workspaceName, setWorkspaceName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const invalidateUserMetrics = useInvalidateUserMetrics();
  const { publicKeySpki, isUnlocked } = useKeyContext();
  const { data: session } = useSession();
  const { canCreateWorkspace, isLoading: isAccessLoading } = useAccess();

  if (!isAccessLoading && !canCreateWorkspace) {
    return (
      <div className="min-h-screen bg-paper flex flex-col justify-between font-sans">
        <PublicHeader />
        <main className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md w-full p-8 flex flex-col items-center text-center gap-4 bg-white border border-border shadow-sm rounded-2xl">
            <h1 className="text-xl font-bold tracking-tight text-ink">
              You can't create another workspace
            </h1>
            <p className="text-sm text-ink-muted leading-relaxed">
              Your account permissions do not allow creating additional workspaces. Only workspace
              owners and administrators can create more workspaces.
            </p>
            <div className="pt-2 w-full">
              <Link to="/workspace" className="w-full block">
                <Button variant="default" className="w-full">
                  Return to Workspace
                </Button>
              </Link>
            </div>
          </Card>
        </main>
        <PublicFooter />
      </div>
    );
  }

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceName.trim() || !projectName.trim()) return;

    const problem =
      nameProblem(thingName('Workspace name'), workspaceName) ??
      nameProblem(thingName('Project name'), projectName);
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const name = workspaceName.trim();
      const firstProjectName = projectName.trim();

      if (!isUnlocked) {
        throw new Error('Unlock your encryption passphrase before creating a workspace.');
      }

      const userId = session?.user?.id;
      if (!userId) {
        throw new Error('Sign in again before creating a workspace.');
      }

      // The browser chooses the ids, so every wrapped key can be bound to them before creation.
      const workspaceId = crypto.randomUUID();
      const projectId = crypto.randomUUID();

      // Everything is wrapped before the first request: a failure here creates nothing.
      let provisioned;
      try {
        provisioned = await provisionWorkspaceKeys({
          workspaceId,
          projectId,
          userId,
          publicKeySpki,
          projectName: firstProjectName,
        });
      } catch (keyErr) {
        throw new Error(
          `Encryption is unavailable, nothing was created. ${
            errorMessage(keyErr) ?? 'The workspace keys could not be wrapped.'
          }`,
          { cause: keyErr },
        );
      }

      const created = await createWorkspace({
        id: workspaceId,
        name,
        encryptedOrgKey: provisioned.encryptedOrgKey,
        project: {
          id: provisioned.project.id,
          name: provisioned.project.name,
          encryptedProjectKey: provisioned.project.encryptedProjectKey,
          creatorEncryptedProjectKey: provisioned.project.creatorEncryptedProjectKey,
        },
      });

      await authClient.organization.setActive({ organizationId: created.id });
      invalidateUserMetrics();
      void navigate(`/w/${created.slug}`);
    } catch (err) {
      setError(errorMessage(err) ?? 'Failed to complete workspace setup.');
      setLoading(false);
    }
  };

  return (
    <div className="bg-paper font-sans text-ink antialiased min-h-screen flex flex-col justify-between selection:bg-ink selection:text-white">
      {/* Unified Public Header without auth action buttons */}
      <PublicHeader fixed={true} hideAuthActions={true} />

      {/* Main Viewport */}
      <main className="flex-1 flex items-center justify-center pt-24 sm:pt-28 pb-16 px-4 sm:px-6 relative">
        <div className="w-full max-w-[600px] mx-auto">
          {/* Top Eyebrow */}
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted mb-3 px-1">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span>A better space to think</span>
          </div>

          {/* Onboarding Card */}
          <Card className="bg-white border border-border rounded-2xl p-6 sm:p-10 shadow-[0_10px_30px_rgba(29,44,59,0.045)] relative">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted mb-1.5">
              Getting started
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink mb-2">
              Create your workspace
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted leading-relaxed mb-6">
              Set up a workspace that fits how you think and collaborate. You can change these
              details later.
            </p>

            {error && (
              <div className="mb-6 p-3.5 bg-danger-soft border border-danger-soft-border text-danger-muted text-xs rounded-lg font-medium">
                {error}
              </div>
            )}

            <form className="flex flex-col space-y-5" onSubmit={handleSetup}>
              {/* Workspace Name Input */}
              <div className="flex flex-col text-left">
                <Label
                  className="text-xs font-semibold text-ink tracking-[-0.01em] mb-1.5 flex items-center justify-between"
                  htmlFor="workspace-name"
                >
                  <span>Workspace Name</span>
                  <span className="font-mono text-[10px] text-ink-subtle font-normal uppercase">
                    Required
                  </span>
                </Label>
                <Input
                  id="workspace-name"
                  name="workspace-name"
                  type="text"
                  {...NOT_A_CREDENTIAL}
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="e.g. Studio North or Acme Engineering"
                  required
                  className="w-full h-11 px-3.5 text-sm"
                />
                <p className="text-[11px] text-ink-muted mt-1.5">
                  The primary home for your team, canvases, and permissions.
                </p>
              </div>

              {/* First Project Name Input */}
              <div className="flex flex-col text-left">
                <Label
                  className="text-xs font-semibold text-ink tracking-[-0.01em] mb-1.5 flex items-center justify-between"
                  htmlFor="project-name"
                >
                  <span>First Project Name</span>
                  <span className="font-mono text-[10px] text-ink-subtle font-normal uppercase">
                    Required
                  </span>
                </Label>
                <Input
                  id="project-name"
                  name="project-name"
                  type="text"
                  {...NOT_A_CREDENTIAL}
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. Product planning or Architecture"
                  required
                  className="w-full h-11 px-3.5 text-sm"
                />
                <p className="text-[11px] text-ink-muted mt-1.5">
                  Projects keep your canvases neatly grouped.
                </p>
              </div>

              {/* Workspace Guide */}
              <div className="p-4 bg-brand-subtle border border-brand-border rounded-xl text-xs text-brand-strong flex items-start gap-3">
                <div className="w-6 h-6 rounded-md bg-white border border-brand-border flex items-center justify-center text-brand shrink-0 font-semibold text-xs mt-0.5 shadow-2xs">
                  ⌘
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-brand-title">How CanvHQ is organized</span>
                  <p className="text-brand text-[11px] leading-relaxed">
                    Your <strong>Workspace</strong> holds team members. Inside it,{' '}
                    <strong>Projects</strong> keep your canvases organized. Every canvas is
                    client-side encrypted automatically.
                  </p>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <Button
                  id="submit-btn"
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 text-xs font-semibold hover:-translate-y-0.5"
                >
                  <span>{loading ? 'Creating workspace...' : 'Create workspace & continue ↗'}</span>
                </Button>
              </div>
            </form>

            <div className="mt-6 pt-4 border-t border-border flex items-center justify-center text-center">
              <p className="text-[11px] text-ink-muted">
                You can change these names and invite team members at any time.
              </p>
            </div>
          </Card>
        </div>
      </main>

      {/* Unified Public Footer */}
      <PublicFooter />
    </div>
  );
}
