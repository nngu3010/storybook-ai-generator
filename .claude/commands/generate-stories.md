# Generate Storybook Stories (MCP-First)

You are generating Storybook stories using MCP tools. No API key is needed — you are the AI. The MCP tools provide structured data and mechanical actions; you provide the reasoning.

## Workflow

### 1. Discover components

Call `list_components` with the project's component directory to find all React/TypeScript components.

If the user specified a component name, find it in the results. If they said "all" or gave a directory, process all components.

### 2. For each component, gather context

Call these tools to understand the component deeply:

**a. `get_component`** — Get full prop metadata: types, required/optional, defaults, JSDoc, variants.

**b. `get_type_definition`** — For EVERY prop with a complex type (interface, object, array of objects — anything that isn't string/number/boolean/union), resolve the full type tree. This is critical. Without it, you'll generate `{}` for complex props and the story will crash.

Example: if a prop is `cartData: Cart`, call `get_type_definition` with `type: "Cart"` to see:
```
Cart → id: string, items: CartItem[], summary: CartSummary
CartItem → product: Product, quantity: number
Product → id: string, name: string, price: number
```

**c. `find_usage_examples`** — See how the component is actually used in production code. Prefer these real values over invented ones.

**d. `get_mock_fixtures`** — Check if the project has existing mock/fixture data you can reuse.

### 3. Craft args

Using all the context above, generate complete, type-correct args:

- **Default story**: Happy path with all required props filled. Use realistic data from usage examples and fixtures when available.
- **Variant stories**: If the component has a variant prop (e.g., `variant: 'primary' | 'secondary'`), create one story per variant value.
- **Complex props**: Build the full nested object matching the resolved type definition. Every required field must be present.
- **Arrays**: Include 2-3 items with varied but realistic data.
- **Consistency**: If a prop is `price` and another is `originalPrice`, ensure `originalPrice > price`.

### 4. Generate stories

Call `generate_stories` with your crafted args:
```json
{
  "dir": "./src/components",
  "components": ["CartFooter"],
  "args": {
    "CartFooter": {
      "Default": {
        "cartData": { "id": "cart-001", "items": [...], "summary": {...} },
        "onCheckout": null
      },
      "variants": {}
    }
  }
}
```

### 5. Validate

Call `validate_story` for each generated story. This checks TypeScript compilation.

### 6. Fix errors (if any)

If validation fails:
1. Read the error message (e.g., "Cannot read properties of undefined (reading 'summary')")
2. Call `get_type_definition` for the failing type
3. Identify the missing/wrong field
4. Call `generate_stories` again with corrected args
5. Re-validate

Retry up to 3 times. If still failing, report the error to the user.

### 7. Report results

Tell the user:
- Which components got stories generated
- How many stories per component (Default + variants)
- Any validation errors that couldn't be auto-fixed

## Tips

- For simple components (all primitive props), you can skip `get_type_definition` and just use `suggest_args` as a quick shortcut.
- Skip function/callback props (onClick, onChange) — they become Storybook actions automatically.
- Skip `ReactNode` props like `children` — they don't need controls.
- If `find_usage_examples` returns real values, prefer those over generic placeholders.
