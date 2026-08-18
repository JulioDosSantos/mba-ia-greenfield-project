---
name: figma-implement-design
description: "Translate verified Figma context into this frontend's components, tokens, assets, and visual checks."
---

# Implement a Figma design

Use only after `$figma-use` has produced design context and a screenshot for the exact node.

1. Load `$next-frontend-conventions` and inspect existing primitives and tokens.
2. Translate the design into the project architecture; do not transcribe generated markup blindly.
3. Reuse `components/ui/` primitives. Add missing primitives through the documented shadcn workflow.
4. Map colors, typography, spacing, radius, and shadows to tokens in `app/globals.css`. Add a token there before consuming a value that has no semantic match.
5. Convert supplied SVGs into typed custom icon components under `components/icons/`; do not add an icon package.
6. Prefer flow layout over unnecessary absolute positioning and Server Components over client boundaries.
7. Verify the rendered result against the screenshot, including responsive layout, hover, focus-visible, disabled, validation, and dark-mode states that are in scope.
