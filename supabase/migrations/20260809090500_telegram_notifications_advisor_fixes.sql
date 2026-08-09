-- Make the service-only intent explicit while keeping all browser access denied.

create policy "No direct access to Telegram link tokens"
  on public.telegram_link_tokens for all
  to authenticated
  using (false)
  with check (false);

create policy "No direct access to Telegram update events"
  on public.telegram_update_events for all
  to authenticated
  using (false)
  with check (false);

