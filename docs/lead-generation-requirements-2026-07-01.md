# Lead Generation Requirements

## Objective

This document restates the current `apply-bot` lead-generation goals in delivery terms based on the user's July 1, 2026 request and the current repository state.

## Required Workflows

### Workflow 1: Similar company discovery from a sample company

- Input:
  - Company name
  - Company website and company context
  - Active prompt
- Expected behavior:
  - AI analyzes the sample company and returns at least 20 similar companies.
  - The search strategy and prompt used for the run are visible to the user.
  - Each recommended company is validated through Google Maps or equivalent map verification evidence.
  - Results retain evidence, fit reasoning, and verification status.

### Workflow 2: Buyer discovery from product/market intent

- Input:
  - Industry
  - Product keywords
  - Market or country
- Expected behavior:
  - AI transforms supplier-facing product queries into buyer-facing search intents.
  - The generated search keywords must be shown before or with the results.
  - The workflow must search for likely buyers rather than peer suppliers.
  - Prompt, generated keywords, provider evidence, and final candidates must all be visible.

### Workflow 3: Address verification

- Input:
  - Company name and address, or address only
- Expected behavior:
  - Google Maps verification remains available.
  - Batch verification remains available.
  - Output includes match confidence, business status, website, phone, address, and evidence URL.

### Workflow 4: Potential-customer search via Google Maps

- Input:
  - Search query and location
- Expected behavior:
  - Google Maps search remains available.
  - Output includes visible search query, filters, company details, and exportable results.

## Prompt and Research Visibility

- Prompt content must be viewable and editable from the UI.
- The rendered prompt used for a run should be inspectable in the result history.
- AI-generated search queries/keywords must be shown to the user.
- Search/verification outputs must be recorded for later review.

## Persistence and Auditability

- Query results, prompts, and research runs should be retained in Gist-backed storage when configured.
- Runs should be visible from the Research Runs view.
- Failures caused by missing environment variables must return explicit `missing_env` responses instead of generic or disabled placeholders.

## Delivery Requirements

1. Requirements document
2. Architecture assessment document
3. Repair plan with acceptance steps
4. Code changes that satisfy the workflows
5. Verified tests/build
6. Git push to GitHub
