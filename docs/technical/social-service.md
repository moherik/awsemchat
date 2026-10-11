# Friendship and Circle service contract

2026-10-11. Owner decisions: contact PIN is fixed; friendship acceptance is mandatory before private communication; Circles contain at most20people including creator; the last admin must select another member before leaving.

Implemented friendship core: requests address random eight-character PINs, return opaque account/request IDs, and store no phone number or plaintext profile. One canonical account pair has one pending request. Duplicate or crossed requests never accept it automatically. Only its recipient accepts or declines. Repeating the same completed response is idempotent and preserves its timestamp; changing a completed response is denied. Blocking is directional in storage but denies communication and requests in either direction, atomically removes the relationship, and invalidates the old request. Unblocking never recreates acceptance; a fresh request is required.

Every operation checks the current session inside its PostgreSQL transaction. Pair advisory locks serialize request, response and block changes. The accepted-friend snapshot method is useful for reads; future messaging/Circle mutations must share the pair authorization lock within their own transaction rather than trusting a previously returned boolean. That shared-transaction interface remains to implement.

Migration002_social adds friend_links and friend_blocks. The migration runner now applies every embedded version and checks every checksum. Circle schema will be added in a subsequent immutable migration; event/media version filenames in the initial roadmap will be reconciled with the actual ordered migration chain rather than changing already-applied SQL.

Evidence: real PostgreSQL17 tests cover recipient-only acceptance, pending authorization denial, mutual blocking, fresh approval after unblocking, old-request replay denial, twenty concurrent crossed requests, invalid/self PINs, revoked sessions and acceptance retries. Full Go suite passes with race detection and vet. HTTP social endpoints, paginated friend/request/block views, request abuse limits, mobile data integration and Circle membership remain incomplete.
