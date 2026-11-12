# Sign in with Google

CanvHQ has no passwords. People sign in with a Google account they already have. You set up one Google sign-in for your instance, and CanvHQ shows a "Continue with Google" button.

Other providers may come later. For now, Google is the one that is documented and tested.

## What you do

1. Create an OAuth client in Google's developer console. Google's own documentation has the current steps.
2. Give it this **callback address**, where `AUTH_URL` is the address you set for CanvHQ:

   `AUTH_URL/api/auth/callback/google`

   For example, if `AUTH_URL` is `https://canvas.example.org`, the callback is `https://canvas.example.org/api/auth/callback/google`.
3. Copy the client ID and secret it gives you into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Restart CanvHQ.

## If it does not work

- **The app will not start in production.** It needs the Google client ID and secret, unless `DEMO_MODE=true`.
- **Google says the callback does not match.** The address must be exactly the one above: same scheme (`https`), same host, no trailing slash, and `AUTH_URL` must be the address people actually use.
- **Sign-in works but you land on an error page.** Check that `FRONTEND_URL` is the same address as `AUTH_URL` when you run the single container.
- **Someone is refused when they sign in.** If you turned off public sign-up (`ALLOW_SIGNUPS=false`), they need an invitation to a workspace first.

For a private instance, set `ALLOW_SIGNUPS=false` and `FIRST_ACCOUNT_EMAIL` to your own address. The first account can then only be yours.
