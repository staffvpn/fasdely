-- Postgres grants EXECUTE to PUBLIC by default at function creation; revoking from
-- anon/authenticated specifically (as 0013_guest_miniapp_foundation.sql did) does not
-- remove the PUBLIC grant, and every role -- including anon/authenticated -- is
-- implicitly a member of PUBLIC. staff_set_stop/staff_set_price authenticate solely via
-- p_telegram_user_id (no auth.uid() check), so leaving them PUBLIC-executable would let
-- any anon/authenticated caller attempt to brute-force telegram_user_id values and
-- manipulate stop-lists/prices for any business. Revoke from PUBLIC explicitly, matching
-- the precedent set by 0010_security_fixes_revoke_correction.sql for this same class of
-- issue.
revoke execute on function staff_set_stop(bigint, uuid, uuid, boolean) from public;
revoke execute on function staff_set_price(bigint, uuid, uuid, numeric) from public;
grant execute on function staff_set_stop(bigint, uuid, uuid, boolean) to service_role, postgres;
grant execute on function staff_set_price(bigint, uuid, uuid, numeric) to service_role, postgres;
