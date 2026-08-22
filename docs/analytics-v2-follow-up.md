# Analytics V2 Follow-up

Workspace V2 intentionally uses only metrics already available to Clarift: plan, weighted refinement allowance, managed credits, saved prompts, aggregate refinements, evaluations, conversions, score improvement, most-used technique, and monthly activity.

The next analytics stage requires server-side, tenant-scoped aggregation for:

- credits used over time;
- top refinement modes and templates;
- recent content-free activity events;
- cost and latency trends by task quality tier.

This work must preserve the existing 90-day content-free event retention policy, avoid storing prompt or response content, and add tenant-isolation and aggregate-reconciliation tests before the new metrics are exposed.
