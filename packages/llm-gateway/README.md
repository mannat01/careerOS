# @careeros/llm-gateway

Multi-provider LLM client: tier routing (cheap|frontier), cost metering, trace attach.

`createLlmProviderFromEnv()` selects `LLM_PROVIDER=fake|anthropic` and defaults
to `fake`. Anthropic selection requires `ANTHROPIC_API_KEY`; callers still pass
the selected provider into `createLlmGateway()` so routing and metering remain on
the single gateway path.

See `docs/project-structure.md` for import boundaries and `docs/architecture.md` for role.
