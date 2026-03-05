# Warp Agent — Security & Specification Compliance Auditor

## TL;DR
> **Summary**: Add Warp, a read-only security and spec compliance auditor that complements Weft. Warp self-triages every review (fast-exits if no security-relevant changes), uses a skeptical bias (opposite of Weft's approval bias), and can webfetch RFCs for verification.
> **Estimated Effort**: Medium

## Context
### Original Request
Add a new agent called **Warp** — a security and specification compliance auditor. It mirrors Weft's read-only structure but focuses on security best practices and spec compliance (OAuth2, OIDC, WebAuthn, JWT, etc.) with a skeptical bias.

### Key Findings
- **Weft pattern is the template**: `src/agents/weft/default.ts` + `index.ts` + `index.test.ts` — Warp follows this exact structure
- **WeaveAgentName is a union type** in `src/agents/types.ts` (line 77-84) — needs `"warp"` added
- **AGENT_FACTORIES** in `src/agents/builtin-agents.ts` (line 26-34) — needs warp factory registered
- **AGENT_METADATA** in `src/agents/builtin-agents.ts` (line 36-120) — needs warp metadata with triggers, cost, useWhen, avoidWhen
- **AGENT_MODEL_REQUIREMENTS** in `src/agents/model-resolution.ts` (line 13-63) — needs warp fallback chain (Sonnet-class)
- **dynamic-prompt-builder.ts** has dedicated section builders per agent (buildWeftSection at line 147) — needs buildWarpSection
- **Loom's prompt** in `src/agents/loom/default.ts` has `<Delegation>` (line 46-54) and `<ReviewWorkflow>` (line 75-92) sections — needs Warp references
- **AGENT_DISPLAY_NAMES** in `src/shared/agent-display-names.ts` (line 9-16) — needs warp entry
- **verification-reminder.ts** (line 39-40) references weft — should also reference warp for security
- **docs** have tables and diagrams listing 7 agents — all need updating to 8
- **Config schema** (`src/config/schema.ts`) uses `z.record(z.string(), ...)` for agent overrides — no schema change needed (it's open-ended), but docs need updating
- **Weft uses haiku-class model** (cheap reviewer). Warp needs **Sonnet-class** (needs reasoning power for spec analysis) — this is a deliberate difference
- **Comment in types.ts** (line 76) says "The 7 built-in Weave agent names" — needs updating to 8

## Objectives
### Core Objective
Add Warp as the 8th built-in Weave agent with full integration across factories, metadata, model resolution, prompts, tests, and documentation.

### Deliverables
- [x] `src/agents/warp/default.ts` — Agent defaults with full security/spec compliance prompt
- [x] `src/agents/warp/index.ts` — Factory function
- [x] `src/agents/warp/index.test.ts` — Unit tests
- [x] Updated `src/agents/types.ts` — WeaveAgentName union includes "warp"
- [x] Updated `src/agents/builtin-agents.ts` — Factory + metadata registered
- [x] Updated `src/agents/model-resolution.ts` — Sonnet-class fallback chain
- [x] Updated `src/agents/dynamic-prompt-builder.ts` — buildWarpSection function
- [x] Updated `src/agents/loom/default.ts` — Delegation + ReviewWorkflow sections
- [x] Updated `src/hooks/verification-reminder.ts` — Reference Warp for security
- [x] Updated `src/shared/agent-display-names.ts` — Display name
- [x] Updated `src/workflow.test.ts` — Warp integration tests
- [x] Updated `README.md` — Agent table + descriptions
- [x] Updated `docs/architecture.md` — Agent system table + capability matrix
- [x] Updated `docs/agent-interactions.md` — Hierarchy + delegation rules
- [x] Updated `docs/configuration.md` — Agent names table + fallback chains

### Definition of Done
- [x] `bun test` passes with zero failures
- [x] `bun run typecheck` passes with zero errors
- [x] `bun run build` completes without errors
- [x] All existing tests continue to pass (no regressions)
- [x] New Warp unit tests pass (factory, permissions, prompt content)
- [x] New Warp integration tests pass in workflow.test.ts

### Guardrails (Must NOT)
- Must NOT change Weft's behavior or prompt
- Must NOT give Warp write/edit/task/call_weave_agent permissions
- Must NOT change existing agent model resolution chains
- Must NOT break any existing tests

## TODOs

- [x] 1. **Create `src/agents/warp/default.ts`**
  **What**: Create the Warp agent defaults with full system prompt. Follow the exact structure of `src/agents/weft/default.ts`.
  **Files**: Create `src/agents/warp/default.ts`
  **Content**:
  ```typescript
  import type { AgentConfig } from "@opencode-ai/sdk"

  export const WARP_DEFAULTS: AgentConfig = {
    temperature: 0.1,
    description: "Warp (Security Auditor)",
    tools: {
      write: false,
      edit: false,
      task: false,
      call_weave_agent: false,
    },
    prompt: `<Role>
  Warp — security and specification compliance auditor for Weave.
  You audit code changes for security vulnerabilities and specification violations.
  Read-only access only. You audit, you do not implement.
  </Role>

  <Triage>
  You are ALWAYS invoked on reviews. Self-triage to avoid wasting time on non-security changes.

  **Step 1: Diff scan** (fast)
  Run \`git diff --stat\` to see what files changed. If the changeset is purely:
  - Documentation (.md files only)
  - Test-only changes (no production code)
  - CSS/styling-only changes
  - Configuration comments or formatting

  Then FAST EXIT with:
  **[APPROVE]**
  **Summary**: No security-relevant changes detected. (Diff: [brief stat])

  **Step 2: Pattern grep** (if Step 1 didn't fast-exit)
  Grep the changed files for security-sensitive patterns:
  - Auth/token handling: \`token\`, \`jwt\`, \`session\`, \`cookie\`, \`bearer\`, \`oauth\`, \`oidc\`, \`saml\`
  - Crypto: \`hash\`, \`encrypt\`, \`decrypt\`, \`hmac\`, \`sign\`, \`verify\`, \`bcrypt\`, \`argon\`, \`pbkdf\`
  - Input handling: \`sanitize\`, \`escape\`, \`validate\`, \`innerHTML\`, \`eval\`, \`exec\`, \`spawn\`, \`sql\`, \`query\`
  - Secrets: \`secret\`, \`password\`, \`api_key\`, \`apikey\`, \`private_key\`, \`credential\`
  - Network: \`cors\`, \`csp\`, \`helmet\`, \`https\`, \`redirect\`, \`origin\`, \`referer\`
  - Headers: \`set-cookie\`, \`x-frame\`, \`strict-transport\`, \`content-security-policy\`

  If NO patterns match, FAST EXIT with [APPROVE].
  If patterns match, proceed to DEEP REVIEW.

  **Step 3: Deep review** (only when triggered)
  Read each security-relevant changed file in full. Apply SecurityReview and SpecificationCompliance checks.
  </Triage>

  <SecurityReview>
  Check for these vulnerability classes in changed code:

  **Injection**
  - SQL injection: parameterized queries required, no string concatenation for SQL
  - XSS: output encoding, no raw innerHTML with user input, CSP headers
  - Command injection: no shell interpolation of user input, use execFile over exec
  - Path traversal: validate/normalize file paths, reject \`../\` sequences

  **Authentication & Authorization**
  - Auth bypass: every protected endpoint checks auth before processing
  - Privilege escalation: role checks are server-side, not client-side
  - Session management: secure, httpOnly, sameSite cookies; session invalidation on logout
  - Password handling: bcrypt/argon2 only, never SHA/MD5 for passwords, salt per-user

  **Token Handling**
  - JWT: verify signature before trusting claims, check exp/nbf/iss/aud
  - Refresh tokens: stored securely, rotated on use, bound to user
  - CSRF: state parameter in OAuth flows, anti-CSRF tokens on state-changing endpoints
  - Token leakage: tokens never in URLs, logs, or error messages

  **Cryptography**
  - Algorithm selection: no MD5/SHA1 for security, minimum AES-256, RSA-2048
  - Key management: keys not hardcoded, rotatable, stored in env/vault
  - Random generation: crypto.randomBytes/crypto.getRandomValues, never Math.random for security

  **Data Exposure**
  - Error leakage: stack traces and internal details hidden from end users
  - Logging: no sensitive data (tokens, passwords, PII) in log output
  - API responses: no over-fetching of sensitive fields

  **Insecure Defaults**
  - CORS: not \`*\` in production, credentials mode requires explicit origins
  - HTTPS: redirects enforced, HSTS headers present
  - Debug mode: disabled in production configs
  </SecurityReview>

  <SpecificationCompliance>
  When code implements a known protocol, verify compliance against the relevant specification.

  **Built-in Spec Reference Table:**

  | Spec | Key Requirements |
  |------|-----------------|
  | RFC 6749 (OAuth 2.0) | Authorization code flow requires PKCE for public clients, redirect_uri exact match, state parameter REQUIRED |
  | RFC 7636 (PKCE) | code_verifier 43-128 chars, code_challenge_method=S256 (plain only for constrained devices) |
  | RFC 7519 (JWT) | Validate exp, nbf, iss, aud before trusting claims; reject alg=none; typ header present |
  | RFC 7517 (JWK) | Key rotation via jwks_uri, kid matching, reject unknown key types |
  | RFC 7009 (Token Revocation) | Revoke both access + refresh tokens, return 200 even for invalid tokens |
  | OIDC Core 1.0 | nonce REQUIRED in implicit/hybrid flows, sub claim is user identifier, id_token signature verification |
  | WebAuthn Level 2 | Challenge must be random >=16 bytes, origin validation, RP ID matching, attestation verification |
  | RFC 6238 (TOTP) | Default period=30s, digits=6, algorithm=SHA1; clock drift tolerance (1-2 steps) |
  | RFC 4226 (HOTP) | Counter synchronization, resync window, throttling after failed attempts |
  | CORS (Fetch Standard) | Preflight for non-simple requests, Access-Control-Allow-Origin not \`*\` with credentials |
  | CSP (Level 3) | script-src avoids \`unsafe-inline\`/\`unsafe-eval\`, default-src as fallback |

  **Verification Protocol:**
  1. Use built-in knowledge (table above) as the primary reference
  2. If confidence is below 90% on a spec requirement, use webfetch to verify against the actual RFC/spec document
  3. If the project has a \`.weave/specs.json\` file, check it for project-specific spec requirements

  **\`.weave/specs.json\` format** (optional, project-provided):
  \`\`\`json
  {
    "specs": [
      {
        "name": "OAuth 2.0",
        "url": "https://datatracker.ietf.org/doc/html/rfc6749",
        "requirements": ["PKCE required for all public clients", "state parameter mandatory"]
      }
    ]
  }
  \`\`\`

  **Citing specs in findings**: Every spec-related finding MUST include:
  - The spec name and section (e.g., "RFC 6749 Section 4.1.1")
  - The specific requirement being violated
  - What the code does vs. what it should do
  </SpecificationCompliance>

  <Verdict>
  Always end with a structured verdict:

  **[APPROVE]** or **[REJECT]**

  **Summary**: 1-2 sentences explaining the verdict.

  If REJECT, list **Blocking Issues** (max 3):
  1. [Specific issue + spec citation if applicable + what needs to change]
  2. [Specific issue + spec citation if applicable + what needs to change]
  3. [Specific issue + spec citation if applicable + what needs to change]

  Each issue must be:
  - Specific (exact file path, exact line/function, exact problem)
  - Actionable (what exactly needs to change)
  - Blocking (genuine security risk or spec violation)
  - Cited (reference spec section when applicable)
  </Verdict>

  <SkepticalBias>
  REJECT by default when security patterns are detected. APPROVE only when confident.

  BLOCKING issues (reject for these):
  - Any authentication or authorization bypass
  - Unparameterized SQL/NoSQL queries with user input
  - Missing CSRF protection on state-changing endpoints
  - Hardcoded secrets, API keys, or private keys
  - Broken cryptography (MD5/SHA1 for security, ECB mode, weak keys)
  - JWT without signature verification or alg=none accepted
  - OAuth flows missing PKCE or state parameter
  - Token/password leakage in logs or URLs
  - Missing input validation on security boundaries
  - CORS wildcard with credentials

  NOT blocking (note but do not reject):
  - Defense-in-depth improvements (nice-to-have additional layers)
  - Non-security code style preferences
  - Performance optimizations unrelated to DoS
  - Missing security headers on non-sensitive endpoints
  </SkepticalBias>

  <Constraints>
  - READ ONLY — never write, edit, or create files
  - Never spawn subagents
  - Max 3 blocking issues per rejection
  - Every spec-related finding must cite the spec name and section
  - Be specific — file paths, line numbers, exact problems
  - Dense > verbose. No filler.
  </Constraints>`,
  }
  ```
  **Acceptance**: File exists at `src/agents/warp/default.ts`, exports `WARP_DEFAULTS` as `AgentConfig`, prompt contains `<Role>`, `<Triage>`, `<SecurityReview>`, `<SpecificationCompliance>`, `<Verdict>`, `<SkepticalBias>`, and `<Constraints>` sections. Tools block write/edit/task/call_weave_agent.

- [x] 2. **Create `src/agents/warp/index.ts`**
  **What**: Create the factory function following Weft's exact pattern.
  **Files**: Create `src/agents/warp/index.ts`
  **Content**:
  ```typescript
  import type { AgentConfig } from "@opencode-ai/sdk"
  import type { AgentFactory } from "../types"
  import { WARP_DEFAULTS } from "./default"

  export const createWarpAgent: AgentFactory = (model: string): AgentConfig => ({
    ...WARP_DEFAULTS,
    tools: { ...WARP_DEFAULTS.tools },
    model,
    mode: "subagent",
  })
  createWarpAgent.mode = "subagent"
  ```
  **Acceptance**: File exports `createWarpAgent` as `AgentFactory`. `createWarpAgent.mode === "subagent"`. Calling `createWarpAgent("test-model")` returns a config with model set.

- [x] 3. **Create `src/agents/warp/index.test.ts`**
  **What**: Create unit tests following Weft's pattern, plus security-specific assertions.
  **Files**: Create `src/agents/warp/index.test.ts`
  **Content**:
  ```typescript
  import { describe, it, expect } from "bun:test"
  import { createWarpAgent } from "./index"

  describe("createWarpAgent", () => {
    it("is a callable factory", () => {
      expect(typeof createWarpAgent).toBe("function")
    })

    it("has mode subagent", () => {
      expect(createWarpAgent.mode).toBe("subagent")
    })

    it("sets model from argument", () => {
      const config = createWarpAgent("claude-sonnet-4")
      expect(config.model).toBe("claude-sonnet-4")
    })

    it("has a non-empty prompt", () => {
      const config = createWarpAgent("claude-sonnet-4")
      expect(typeof config.prompt).toBe("string")
      expect(config.prompt!.length).toBeGreaterThan(0)
    })

    it("denies write tool", () => {
      const config = createWarpAgent("claude-sonnet-4")
      expect(config.tools?.["write"]).toBe(false)
    })

    it("denies edit tool", () => {
      const config = createWarpAgent("claude-sonnet-4")
      expect(config.tools?.["edit"]).toBe(false)
    })

    it("denies task tool", () => {
      const config = createWarpAgent("claude-sonnet-4")
      expect(config.tools?.["task"]).toBe(false)
    })

    it("denies call_weave_agent tool", () => {
      const config = createWarpAgent("claude-sonnet-4")
      expect(config.tools?.["call_weave_agent"]).toBe(false)
    })

    it("description contains Security or Auditor", () => {
      const config = createWarpAgent("claude-sonnet-4")
      const desc = config.description ?? ""
      expect(desc.toLowerCase()).toMatch(/security|auditor/)
    })

    it("prompt contains security review sections", () => {
      const config = createWarpAgent("claude-sonnet-4")
      const prompt = config.prompt as string
      expect(prompt).toContain("<SecurityReview>")
      expect(prompt).toContain("<SpecificationCompliance>")
      expect(prompt).toContain("<Triage>")
    })

    it("prompt has skeptical bias (opposite of Weft)", () => {
      const config = createWarpAgent("claude-sonnet-4")
      const prompt = config.prompt as string
      expect(prompt).toContain("REJECT by default")
    })

    it("prompt contains spec reference table", () => {
      const config = createWarpAgent("claude-sonnet-4")
      const prompt = config.prompt as string
      expect(prompt).toContain("RFC 6749")
      expect(prompt).toContain("RFC 7636")
      expect(prompt).toContain("RFC 7519")
      expect(prompt).toContain("OIDC Core")
      expect(prompt).toContain("WebAuthn")
    })

    it("prompt contains verdict structure with APPROVE and REJECT", () => {
      const config = createWarpAgent("claude-sonnet-4")
      const prompt = config.prompt as string
      expect(prompt).toContain("[APPROVE]")
      expect(prompt).toContain("[REJECT]")
      expect(prompt).toContain("blocking issues")
    })

    it("prompt references webfetch for RFC verification", () => {
      const config = createWarpAgent("claude-sonnet-4")
      const prompt = config.prompt as string
      expect(prompt).toContain("webfetch")
    })

    it("prompt references .weave/specs.json", () => {
      const config = createWarpAgent("claude-sonnet-4")
      const prompt = config.prompt as string
      expect(prompt).toContain(".weave/specs.json")
    })
  })
  ```
  **Acceptance**: `bun test src/agents/warp/index.test.ts` passes all tests.

- [x] 4. **Update `src/agents/types.ts` — Add "warp" to WeaveAgentName**
  **What**: Add `"warp"` to the WeaveAgentName union type and update the comment.
  **Files**: Modify `src/agents/types.ts`
  **Changes**:
  - Line 76: Change comment from `The 7 built-in Weave agent names` to `The 8 built-in Weave agent names`
  - Lines 77-84: Add `| "warp"` to the union, after `"weft"`:
    ```typescript
    export type WeaveAgentName =
      | "loom"
      | "tapestry"
      | "shuttle"
      | "pattern"
      | "thread"
      | "spindle"
      | "weft"
      | "warp"
    ```
  **Acceptance**: `bun run typecheck` passes. The type includes "warp".

- [x] 5. **Update `src/agents/builtin-agents.ts` — Register factory + metadata**
  **What**: Import `createWarpAgent`, add to `AGENT_FACTORIES`, and add `AGENT_METADATA` entry.
  **Files**: Modify `src/agents/builtin-agents.ts`
  **Changes**:
  - Add import at line 8 (after weft import): `import { createWarpAgent } from "./warp"`
  - Add to `AGENT_FACTORIES` object (after `weft: createWeftAgent,` on line 33):
    ```typescript
    warp: createWarpAgent,
    ```
  - Add to `AGENT_METADATA` object (after the weft entry, before the closing `}`):
    ```typescript
    warp: {
      category: "advisor",
      cost: "EXPENSIVE",
      triggers: [
        { domain: "Security Review", trigger: "After changes touching auth, crypto, tokens, or input handling" },
        { domain: "Spec Compliance", trigger: "When implementing OAuth, OIDC, WebAuthn, JWT, or similar protocols" },
      ],
      useWhen: [
        "After implementing authentication or authorization logic",
        "When adding/modifying token handling, JWT, or session management",
        "After changes to cryptographic operations or key management",
        "When implementing OAuth2, OIDC, WebAuthn, or similar specs",
        "After modifying CORS, CSP, or security headers",
      ],
      avoidWhen: [
        "Pure documentation or README changes",
        "CSS/styling-only changes with no security implications",
        "Test-only changes that don't modify security test assertions",
      ],
    },
    ```
  **Acceptance**: TypeScript compiles. `AGENT_FACTORIES.warp` is `createWarpAgent`. `AGENT_METADATA.warp` has category "advisor" and cost "EXPENSIVE".

- [x] 6. **Update `src/agents/model-resolution.ts` — Add Sonnet-class fallback chain**
  **What**: Add warp entry to `AGENT_MODEL_REQUIREMENTS` with Sonnet-class models (needs reasoning power for spec analysis, unlike Weft's haiku-class).
  **Files**: Modify `src/agents/model-resolution.ts`
  **Changes**:
  - Add after the `weft` entry (line 62, before the closing `}`):
    ```typescript
    warp: {
      fallbackChain: [
        { providers: ["github-copilot"], model: "claude-sonnet-4.6" },
        { providers: ["anthropic"], model: "claude-sonnet-4" },
        { providers: ["openai"], model: "gpt-5" },
      ],
    },
    ```
  **Acceptance**: `bun run typecheck` passes (all WeaveAgentName values now have entries).

- [x] 7. **Update `src/agents/dynamic-prompt-builder.ts` — Add buildWarpSection**
  **What**: Add a `buildWarpSection` function following the same pattern as `buildWeftSection` (line 147-163).
  **Files**: Modify `src/agents/dynamic-prompt-builder.ts`
  **Changes**:
  - Add the following function after `buildWeftSection` (after line 163):
    ```typescript
    export function buildWarpSection(agents: AvailableAgent[]): string {
      const warpAgent = agents.find((a) => a.name === "warp")
      if (!warpAgent) return ""

      const useWhen = warpAgent.metadata.useWhen ?? []
      const avoidWhen = warpAgent.metadata.avoidWhen ?? []

      return `### Warp Agent = Security Gate

    Invoke after security-relevant changes for a read-only security audit. Skeptical-biased — rejects when security patterns are at risk.

    **Use Warp when:**
    ${useWhen.map((w) => `- ${w}`).join("\n")}

    **Skip Warp when:**
    ${avoidWhen.map((w) => `- ${w}`).join("\n")}`
    }
    ```
  **Acceptance**: `buildWarpSection` is exported. When called with an agents array containing a "warp" agent, returns a non-empty string with "Security Gate" and use/avoid lists. Returns "" when warp is not in the array.

- [x] 8. **Update `src/agents/loom/default.ts` — Add Warp to Delegation and ReviewWorkflow**
  **What**: Update Loom's system prompt to reference Warp for security auditing.
  **Files**: Modify `src/agents/loom/default.ts`
  **Changes**:
  - In the `<Delegation>` section (line 46-54), add after the Weft line (line 52):
    ```
    - Use Warp for security audits when changes touch auth, crypto, tokens, or input validation
    ```
    So the full Delegation section becomes:
    ```
    <Delegation>
    - Use thread for fast codebase exploration (read-only, cheap)
    - Use spindle for external docs and research (read-only)
    - Use pattern for detailed planning before complex implementations
    - Use /start-work to hand off to Tapestry for todo-list driven execution of multi-step plans
    - Use shuttle for category-specific specialized work
    - Use Weft for reviewing completed work or validating plans before execution
    - Use Warp for security audits when changes touch auth, crypto, tokens, or input validation
    - Delegate aggressively to keep your context lean
    </Delegation>
    ```
  - In the `<ReviewWorkflow>` section (line 75-92), add a Warp subsection after the Weft workflow. Insert before `</ReviewWorkflow>`:
    ```

    For security-relevant changes, also delegate to Warp:
    - Warp is read-only and skeptical-biased — it rejects when security is at risk
    - Warp self-triages: if no security-relevant changes, it fast-exits with APPROVE
    - If Warp rejects: address the specific security issues before shipping
    - Run Warp in parallel with Weft for comprehensive coverage
    ```
  **Acceptance**: Loom's prompt contains "Warp" in both `<Delegation>` and `<ReviewWorkflow>` sections.

- [x] 9. **Update `src/hooks/verification-reminder.ts` — Reference Warp**
  **What**: Add a Warp reference to the verification reminder prompt for security-relevant reviews.
  **Files**: Modify `src/hooks/verification-reminder.ts`
  **Changes**:
  - After the existing weft reference (line 39-40), add a warp reference. The verification prompt block (lines 29-42) should become:
    ```typescript
    verificationPrompt: `## Verification Required
    ${planContext}

    Before marking this task complete, verify the work:

    1. **Read the changes**: \`git diff --stat\` then Read each changed file
    2. **Run checks**: Run relevant tests, check for linting/type errors
    3. **Validate behavior**: Does the code actually do what was requested?
    4. **Gate decision**: Can you explain what every changed line does?

    If uncertain about quality, delegate to \`weft\` agent for a formal review:
    \`call_weave_agent(agent="weft", prompt="Review the changes for [task description]")\`

    If changes touch auth, crypto, tokens, or input validation, delegate to \`warp\` agent for a security audit:
    \`call_weave_agent(agent="warp", prompt="Security audit the changes for [task description]")\`

    Only mark complete when ALL checks pass.`,
    ```
  **Acceptance**: `buildVerificationReminder()` output contains both "weft" and "warp".

- [x] 10. **Update `src/shared/agent-display-names.ts` — Add warp display name**
  **What**: Add "warp" to the `AGENT_DISPLAY_NAMES` map. Since Warp is a subagent (like weft), it should use lowercase style.
  **Files**: Modify `src/shared/agent-display-names.ts`
  **Changes**:
  - Add after `spindle: "spindle",` (line 15):
    ```typescript
    warp: "warp",
    ```
    Note: Following the pattern where subagents (shuttle, pattern, thread, spindle) use lowercase. Weft is missing from this map, so also add weft for consistency:
    ```typescript
    weft: "weft",
    warp: "warp",
    ```
    Actually, looking at the current map, `weft` is NOT in AGENT_DISPLAY_NAMES (only loom, tapestry, shuttle, pattern, thread, spindle are). The `getAgentDisplayName` function falls back to the original key for unknown agents, so weft works without an entry. For consistency, just add warp:
    ```typescript
    warp: "warp",
    ```
  **Acceptance**: `getAgentDisplayName("warp")` returns "warp".

- [x] 11. **Update `src/workflow.test.ts` — Add Warp integration tests**
  **What**: Add a "Phase 7: Warp Security Gate" test section following the Phase 6 Weft pattern.
  **Files**: Modify `src/workflow.test.ts`
  **Changes**:
  - Add import for createWarpAgent at line 31 (after createWeftAgent import):
    ```typescript
    import { createWarpAgent } from "./agents/warp"
    ```
  - Add a new test section after "Phase 6: Weft Review Gate" (after line 443), before the Integration section:
    ```typescript
    // ---------------------------------------------------------------------------
    // Phase 7: Warp Security Gate
    // ---------------------------------------------------------------------------

    describe("Phase 7: Warp Security Gate", () => {
      it("Warp agent config enforces read-only access", () => {
        const config = createWarpAgent("test-model")

        expect(config.tools?.write).toBe(false)
        expect(config.tools?.edit).toBe(false)
        expect(config.tools?.task).toBe(false)
        expect(config.tools?.call_weave_agent).toBe(false)
        expect(config.temperature).toBe(0.1)
      })

      it("Warp agent prompt contains security audit guidelines", () => {
        const config = createWarpAgent("test-model")
        const prompt = config.prompt as string

        expect(prompt).toContain("blocking issues")
        expect(prompt).toContain("APPROVE")
        expect(prompt).toContain("REJECT")
        expect(prompt).toContain("SecurityReview")
        expect(prompt).toContain("SpecificationCompliance")
        // Skeptical bias (opposite of Weft)
        expect(prompt).toContain("REJECT by default")
      })

      it("Warp agent prompt contains spec reference table", () => {
        const config = createWarpAgent("test-model")
        const prompt = config.prompt as string

        expect(prompt).toContain("RFC 6749")
        expect(prompt).toContain("RFC 7636")
        expect(prompt).toContain("JWT")
        expect(prompt).toContain("OIDC")
        expect(prompt).toContain("WebAuthn")
      })

      it("tool permission system blocks Warp from writing", () => {
        const permissions = createToolPermissions({
          warp: { write: false, edit: false, task: false, call_weave_agent: false },
        })

        expect(permissions.isToolAllowed("warp", "write")).toBe(false)
        expect(permissions.isToolAllowed("warp", "edit")).toBe(false)
        expect(permissions.isToolAllowed("warp", "task")).toBe(false)
        expect(permissions.isToolAllowed("warp", "call_weave_agent")).toBe(false)
        // Read tools are not restricted
        expect(permissions.isToolAllowed("warp", "read")).toBe(true)
        expect(permissions.isToolAllowed("warp", "glob")).toBe(true)
      })

      it("verification reminder references both weft and warp", () => {
        const result = buildVerificationReminder({
          planName: "auth-feature",
          progress: { total: 3, completed: 3 },
        })

        expect(result.verificationPrompt).not.toBeNull()
        expect(result.verificationPrompt!.toLowerCase()).toContain("weft")
        expect(result.verificationPrompt!.toLowerCase()).toContain("warp")
      })
    })
    ```
  **Acceptance**: `bun test src/workflow.test.ts` passes including the new Phase 7 tests. Existing Phase 6 tests continue to pass.

- [x] 12. **Update `README.md` — Add Warp to agent table and descriptions**
  **What**: Update the agent count, add Warp row to the agent table, and add Warp description paragraph.
  **Files**: Modify `README.md`
  **Changes**:
  - Line 43: Change `7 specialized agents` to `8 specialized agents`
  - Agent table (after the Weft row on line 61): Add:
    ```
    | **Warp** | security auditor | subagent | Audits code changes for security vulnerabilities and specification compliance with a skeptical bias. |
    ```
  - After the Weft description paragraph (after line 75), add:
    ```

    **Warp** is the security and specification compliance auditor. It reviews code changes for security vulnerabilities (injection, auth bypass, token handling, crypto weaknesses) and verifies compliance with standards like OAuth2, OIDC, WebAuthn, and JWT. Warp has a skeptical bias — unlike Weft, it rejects by default when security patterns are detected. It self-triages to fast-exit on non-security changes. Warp is read-only and can webfetch RFCs for verification.
    ```
  **Acceptance**: README contains Warp in the agent table and a description paragraph.

- [x] 13. **Update `docs/architecture.md` — Add Warp to agent system tables**
  **What**: Update agent count references and add Warp to all agent tables.
  **Files**: Modify `docs/architecture.md`
  **Changes**:
  - Line 3: Change `7 specialized agents` to `8 specialized agents`
  - Line 12: Change `8 lifecycle handlers` to keep as-is (lifecycle handlers didn't change)
  - Line 63: Change `For each of 7 agents` to `For each of 8 agents`
  - Line 84: Change `7 agent registrations` to `8 agent registrations`
  - Line 97: Change `7 specialized agents` to `8 specialized agents`
  - Agent table (after Weft row on line 107): Add:
    ```
    | **Warp** | Security auditor — flags vulnerabilities and spec violations | subagent | expensive | Read-only |
    ```
  - Line 112: Change comment to include Warp: `(Pattern, Thread, Spindle, Weft, Warp)`
  - Line 129: Add after Weft line: `- **Warp** is read-only with skeptical security bias (write/edit tools disabled)`
  - Agent Capability Matrix (after Weft row on line 292): Add:
    ```
    Warp              ✓     ✗      ✗     ✗      ✓       ✓     ✓     ✓
    ```
  **Acceptance**: All "7" references updated to "8". Warp appears in both tables and the capability matrix.

- [x] 14. **Update `docs/agent-interactions.md` — Add Warp to hierarchy and delegation**
  **What**: Add Warp to the agent hierarchy diagram, delegation rules table, and review workflow.
  **Files**: Modify `docs/agent-interactions.md`
  **Changes**:
  - Agent hierarchy mermaid diagram (lines 7-35): Add Warp node and connection:
    ```
    Warp["🔒 Warp<br/>(Security Auditor)"]
    ```
    Add edge:
    ```
    Loom -->|"security audit"| Warp
    ```
    Add style:
    ```
    style Warp fill:#E74C3C,color:#fff
    ```
  - Delegation rules table (lines 39-51): Add row after Weft:
    ```
    | Loom | Warp | Security-relevant changes need auditing |
    ```
    Add Warp's "no delegation" row:
    ```
    | Warp | *(none)* | Read-only security audit, no delegation |
    ```
  **Acceptance**: Warp appears in the hierarchy diagram, delegation table, and has a "no delegation" row.

- [x] 15. **Update `docs/configuration.md` — Add Warp to agent names table and fallback chains**
  **What**: Add Warp to the agent names table and fallback chain table.
  **Files**: Modify `docs/configuration.md`
  **Changes**:
  - Agent names table (after weft row, line 118): Add:
    ```
    | `warp` | warp | Security auditor |
    ```
  - Fallback chains table (after Weft row, line 193): Add:
    ```
    | Warp | anthropic → openai → google |
    ```
  **Acceptance**: Warp appears in both configuration tables.

## Verification
- [x] `bun test` — All tests pass (existing + new)
- [x] `bun run typecheck` — Zero type errors
- [x] `bun run build` — Builds without errors or warnings
- [x] `bun test src/agents/warp/index.test.ts` — All 15 Warp unit tests pass
- [x] `bun test src/workflow.test.ts` — All workflow tests pass including Phase 7
- [x] No regressions in any existing agent behavior
- [x] Warp agent is correctly registered and resolvable by name
