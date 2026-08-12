# @careeros/llm-gateway

Multi-provider LLM client: tier routing (cheap|frontier), cost metering, trace attach.

`createLlmProviderFromEnv()` selects `LLM_PROVIDER=fake|anthropic|omniroute` and
defaults to `fake`. OmniRoute requires `OMNIROUTE_BASE_URL`,
`OMNIROUTE_API_KEY`, and `OMNIROUTE_MODEL`; callers still pass the selected
provider into `createLlmGateway()` so routing and metering remain on the single
gateway path.

See `docs/project-structure.md` for import boundaries and `docs/architecture.md` for role.
