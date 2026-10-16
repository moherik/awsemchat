# Conversation reporting

A report is an explicit disclosure initiated by a signed-in participant. The reporter chooses a reason, may add a short explanation, and selects zero or more text excerpts from the current private conversation. Only those selected excerpts and the metadata needed to review the report are submitted. AwsemChat does not attach the whole conversation, media bytes, or message history implicitly.

The report API accepts only private conversations between currently accepted, unblocked friends. It verifies that each selected server event belongs to the submitted conversation and is accessible to the reporter, and refuses redacted messages. The relay stores only opaque encrypted message envelopes during normal chat; report excerpts are intentionally disclosed to the report service for review. A report is idempotent by a client operation ID, and reusing that ID with different content is rejected.

Reports are retained for 90 days from creation. The API sets expiry on the server and deletes expired report rows in its cleanup worker. There is no report-review console in this slice; production moderation access, staff audit controls, deletion requests, and abuse-rate limits require a separate operational design before public release.

Android uses the real report form and authenticated API. The web preview remains demo-backed by owner direction. See [project status](project-status.md) for current verification and remaining release work.
