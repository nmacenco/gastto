# Telegram access: operator and reviewer runbook

## Before enabling production

1. Keep the public site as a static link to the bot; it does not collect email.
2. Apply additive Drizzle migrations `0016_hesitant_sersi.sql` and `0017_graceful_overlord.sql` using the deployment database procedure. Take the normal release backup. These migrations were generated locally; they have not been applied to production by this work.
3. Establish a separate Google OAuth client for the operator Gmail account with only `https://www.googleapis.com/auth/gmail.send`. Verify its publishing/verification status and refresh-token durability with a real send before enabling unattended notifications. An External/Testing grant may expire after seven days. Never reuse the product user's OAuth scopes or credentials.
4. Set `ACCESS_APPROVAL_ENABLED=true` and all five `ADMIN_*` secrets in the production deployment. Keep the CLI accessible only to the deployment owner. Existing users must have an approved local association before enabling the gate; otherwise they will be asked for an email.
5. Confirm the reviewer's email is in the production Google Auth Platform allowed audience. The bot cannot read this list. Do not use a separate reviewer bypass.

## Normal journey

1. The reviewer opens the production bot and sends `/start`. The bot requests an email if that Telegram chat has no approved association, even when Google Cloud already lists the email.
2. The reviewer sends the Google account email. The bot confirms the pending request. The operator Gmail notice contains the request UUID, Telegram chat ID, requested email and, for replacement, the previous active email. No model API call should run.
3. The owner confirms the email in Google Cloud and runs `node dist/interfaces/cli/approveAccessRequest.js <request-uuid>` inside the deployment. Exit 0 means approved or already approved; exit 2 means missing/stale; exit 1 means a delivery or infrastructure failure. Rerunning the same UUID retries an unsent Telegram notice.
4. The reviewer receives the approval notice, types exactly `continuar`, completes Google OAuth, selects a test spreadsheet and sheet, confirms mapping/categories/payment methods, then records a test expense. Use a spreadsheet created for the review account; access to the owner's spreadsheet is not assumed.

## Recovery and change of email

- If the operator email did not arrive, inspect `ACCESS_REQUEST_MAIL_FAILED` and run `node dist/interfaces/cli/notifyAccessRequest.js <request-uuid>` for the current pending request. A Gmail timeout can mean the message was accepted; a manual resend may duplicate it. Match by request UUID.
- If approval completed but Telegram notification failed, rerun the approval CLI with the same UUID. The approval decision is not repeated.
- If OAuth is denied or the link expires, type `continuar` again to create a fresh link. The typed email is not verified against the Google identity; a different account can fail at OAuth or spreadsheet access.
- To change an active email, open `configuración`, select option 7, submit the new email, wait for owner approval, open option 7 again and type `continuar`. The old email, token and spreadsheet stay active until a new spreadsheet configuration is confirmed. Cancel or timeout discards the candidate credential. Remove the old email from the Google Cloud allowed audience only after cutover, if desired; removing it does not itself revoke a previously issued token.

## Manual canary and rollback

Record the request UUID, environment, migration version, approval result, Telegram delivery, OAuth callback result, spreadsheet ID (never tokens), and whether a model call occurred before OAuth. Run the same path with a normal user and reviewer account. Check the pending, denied OAuth, notification failure and replacement cancellation paths. A local test cannot establish Google Cloud allowlist, Gmail grant durability, or production bot behavior.

For application rollback, turn `ACCESS_APPROVAL_ENABLED=false` in the deployment and revert the release merge according to the normal deployment guide. Leave additive migration files intact; a later migration is required to reverse schema changes. Before disablement, consider that it also removes the new admission gate. Do not print Gmail or Google OAuth secrets in logs or review evidence.
