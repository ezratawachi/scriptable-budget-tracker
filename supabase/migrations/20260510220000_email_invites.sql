-- ============================================================
-- Email-targeted invites: replace public-token model with
-- per-email pending invitations (Google Sheets style).
-- ============================================================

-- Add invitee_email column
alter table public.invites add column if not exists invitee_email text;

-- Case-insensitive lookup index for the recipient's pending invites
create index if not exists invites_invitee_email_idx
  on public.invites (lower(invitee_email))
  where used_at is null;

-- Tighten the read policy: only the inviter, the matching invitee, or the
-- already-claimed user can read an invite. (The previous "select using (true)"
-- was a hangover from the link-only model where the token was the secret.)
drop policy if exists "invites_read_any" on public.invites;
drop policy if exists "invites_read" on public.invites;
create policy "invites_read"
on public.invites
for select
to authenticated
using (
  inviter_id = auth.uid()
  or used_by = auth.uid()
  or (invitee_email is not null and lower(invitee_email) = lower(auth.jwt() ->> 'email'))
);

-- Tighten the claim policy: only the addressed invitee can claim
drop policy if exists "invites_claim" on public.invites;
create policy "invites_claim"
on public.invites
for update
to authenticated
using (
  used_at is null
  and expires_at > now()
  and invitee_email is not null
  and lower(invitee_email) = lower(auth.jwt() ->> 'email')
)
with check (used_by = auth.uid());
