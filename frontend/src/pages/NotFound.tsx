import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/lib/auth-client';
import { AppHeader } from '@/components/AppHeader';
import { PublicHeader } from '@/components/PublicHeader';
import { PublicFooter } from '@/components/PublicFooter';
import { buttonVariants } from '@/components/ui/button';

export function NotFound() {
  const { data: session } = useSession();

  useEffect(() => {
    document.title = '404 - Page Not Found · CanvHQ';
  }, []);

  return (
    <div className="bg-paper min-h-screen text-ink font-sans flex flex-col justify-between selection:bg-ink selection:text-white">
      {session ? <AppHeader /> : <PublicHeader />}

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-20 text-center">
        <span className="font-mono text-sm uppercase tracking-widest text-ink-muted font-bold mb-3">
          404 Error
        </span>
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-ink mb-4 font-serif">
          Page not found
        </h1>
        <p className="max-w-md text-sm sm:text-base text-ink-muted leading-relaxed mb-8">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          to={session ? '/workspace' : '/'}
          className={buttonVariants({ size: 'lg', className: 'rounded-xl font-semibold' })}
        >
          {session ? 'Return to Workspace' : 'Return to Home'}
        </Link>
      </main>

      <PublicFooter />
    </div>
  );
}
