# Keys and roles

## Four roles

Every member of a workspace has one role.

| Role | What they can do |
| :--- | :--- |
| **Owner** | Everything an Admin can do, and delete the workspace or hand it to another member. There is exactly one Owner. |
| **Admin** | Open every project, manage members, invite people, and complete other members' access to projects. |
| **Editor** | Create and change canvases in the projects they have been given. |
| **Viewer** | Open canvases in the projects they have been given. |

Invitations offer the Editor or Viewer role, and can name the projects the person gets. An Admin or Owner gets every project automatically. An Editor or Viewer who has not been given a project does not see it.

## Your passphrase

Your passphrase unlocks your own key, and that key opens the rest. We cannot reset it, and there is no override for an operator. If you lose it, your canvases cannot be opened. Other members are not affected: each opens the workspace with their own passphrase.

## Inviting someone

An invitation is a link you copy and send yourself; CanvHQ sends no email. The invited person signs in, sets a passphrase, and joins. Their access to a project stays pending until someone who already holds that project's key completes it. That keeps the keys inside the browsers of people who already have them.

## Removing someone

When you remove a member:

1. They lose access straight away.
2. The keys of the projects they could open are replaced, and the canvases are saved again under the new keys. This is done by an Administrator's browser, the next time they open the workspace page. Until then the canvases are still under the old keys.
3. If the person removed was an Admin, the workspace key is replaced first and then the project keys.

What this protects: canvases saved from then on. What it does not: anything the person already saw, copied or exported. A canvas with an active public link keeps its key until the link is turned off, because anyone with the link needs it.

The page shows progress ("Securing boards: 3 of 12") with Pause and Resume. One run handles up to 1,000 canvases; the next visit continues.

## Public links

A public link lets anyone who has it read a canvas. The key is inside the link after `#`, and browsers do not send that part to the server. Turn the link off and it stops working. People can pass a link on, so share it only with people you trust.
