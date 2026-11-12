import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { AuthenticatedFooter } from '@/components/AuthenticatedFooter';
import { useHomeWorkspaceSlug } from '@/features/workspaces/queries';
import { DangerZoneSection } from '@/features/user/components/DangerZoneSection';
import { DataExportSection } from '@/features/user/components/DataExportSection';
import { LinkedAccountsSection } from '@/features/user/components/LinkedAccountsSection';
import { PassphraseSection } from '@/features/user/components/PassphraseSection';
import { PersonalInfoSection } from '@/features/user/components/PersonalInfoSection';
import { ProfileAsideNotes } from '@/features/user/components/ProfileAsideNotes';
import { ProfileSidebar } from '@/features/user/components/ProfileSidebar';

export function Profile() {
  const { data: homeSlug } = useHomeWorkspaceSlug();

  return (
    <div className="bg-paper min-h-screen text-ink font-sans antialiased flex flex-col justify-between selection:bg-ink selection:text-white">
      <AppHeader currentSlug={homeSlug ?? undefined} />

      <div className="pt-14 sm:pt-16 flex-1 flex flex-col w-full max-w-[94rem] mx-auto">
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[244px_minmax(0,1fr)] min-h-[calc(100vh-3.5rem)] sm:min-h-[calc(100vh-4rem)]">
          <ProfileSidebar />

          <main className="p-6 md:p-10 flex-1 flex flex-col gap-8 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted font-semibold mb-1">
                  Identity Management · User Profile
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">
                  Profile & Account Settings
                </h1>
                <p className="text-xs text-ink-muted mt-1">
                  Manage your personal profile, linked identity providers, and workspace ownership.
                </p>
              </div>

              <Link
                to="/workspace"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-paper border border-border text-xs font-semibold text-ink rounded-xl shadow-2xs transition-colors self-start shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-brand" />
                <span>Back to Workspace</span>
              </Link>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start">
              <div className="flex flex-col gap-6 min-w-0">
                <PersonalInfoSection />
                <LinkedAccountsSection />
                <PassphraseSection />
                <DataExportSection />
                <DangerZoneSection />
              </div>

              <ProfileAsideNotes />
            </div>
          </main>
        </div>
      </div>

      <AuthenticatedFooter />
    </div>
  );
}
