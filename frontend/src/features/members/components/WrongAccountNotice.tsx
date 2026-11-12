import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WrongAccountNoticeProps {
  /** The invited address with most of it hidden; absent if the server did not send one. */
  invitedAs: string | undefined;
  signedInAs: string;
  onSwitchAccount: () => void;
}

/** Shown when the signed-in account is not the one the invitation was sent to. */
export function WrongAccountNotice({
  invitedAs,
  signedInAs,
  onSwitchAccount,
}: WrongAccountNoticeProps) {
  return (
    <div role="alert" className="flex flex-col gap-3">
      <div className="p-3.5 bg-warning-subtle border border-warning-border text-warning text-xs rounded-xl leading-relaxed">
        <p className="font-semibold">This invitation was sent to a different account.</p>
        <p className="mt-1">
          {invitedAs ? (
            <>
              It is for <span className="font-mono">{invitedAs}</span>, and you are signed in
              as{' '}
            </>
          ) : (
            <>You are signed in as </>
          )}
          <span className="font-mono">{signedInAs}</span>. Sign out, then sign in with the invited
          account to accept it.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onSwitchAccount} className="w-full">
        <LogOut className="w-3.5 h-3.5" />
        <span>Sign out and use another account</span>
      </Button>
    </div>
  );
}
