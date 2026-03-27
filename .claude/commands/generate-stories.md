# Generate Storybook Stories (MCP-First)

You are generating Storybook stories using MCP tools. No API key is needed — you are the AI. The MCP tools provide structured data and mechanical actions; you provide the reasoning.

## Workflow

### 1. Discover components

Call `list_components` with the project's component directory to find all React/TypeScript components.

If the user specified a component name, find it in the results. If they said "all" or gave a directory, process all components.

### 2. For each component, gather context

Call these tools to understand the component deeply:

**a. `get_component`** — Get full prop metadata: types, required/optional, defaults, JSDoc, variants. **Check the `requiredProviders` field** — if present (e.g., `["Redux", "React Router"]`), the generated story will automatically include decorator wrappers for these providers.

**b. `get_type_definition`** — For EVERY prop with a complex type (interface, object, array of objects — anything that isn't string/number/boolean/union), resolve the full type tree. This is critical. Without it, you'll generate `{}` for complex props and the story will crash.

Example: if a prop is `cartData: Cart`, call `get_type_definition` with `type: "Cart"` to see:
```
Cart -> id: string, items: CartItem[], summary: CartSummary
CartItem -> product: Product, quantity: number
Product -> id: string, name: string, price: number
```

**c. `find_usage_examples`** — See how the component is actually used in production code. Prefer these real values over invented ones.

**d. `get_mock_fixtures`** — Check if the project has existing mock/fixture data you can reuse.

### 3. Craft args

Using all the context above, generate complete, type-correct args:

- **Default story**: Happy path with all required props filled. Use realistic data from usage examples and fixtures when available.
- **Variant stories**: If the component has a variant prop (e.g., `variant: 'primary' | 'secondary'`), create one story per variant value.
- **State stories**: Detect boolean/state props and create stories for each meaningful state:
  - `loading`/`isLoading` -> **Loading** story with `loading: true`
  - `error`/`isError` -> **Error** story with an error value
  - `disabled` -> **Disabled** story with `disabled: true`
  - `selected`/`checked`/`active` -> corresponding toggled story
  - Array/list props -> **Empty** story with `[]` for the array
- **Complex props**: Build the full nested object matching the resolved type definition. Every required field must be present.
- **Arrays**: Include 2-3 items with varied but realistic data.
- **Consistency**: If a prop is `price` and another is `originalPrice`, ensure `originalPrice > price`.

#### Composing args for composite components

If a component renders children (has `children`/`ReactNode` props or array props typed as another component's data), **compose args from the child component's data shape**:

1. Look at the child component's props (via `get_component`) to understand the expected data shape.
2. Build array items that match the child's prop structure, varying key fields for realistic data.
3. Example: If `TaskList` has `tasks: TaskData[]` and the `Task` component uses `{ id, title, state }`:
   ```json
   "tasks": [
     { "id": "1", "title": "Buy groceries", "state": "TASK_INBOX" },
     { "id": "2", "title": "Review PR", "state": "TASK_PINNED" },
     { "id": "3", "title": "Deploy to staging", "state": "TASK_INBOX" }
   ]
   ```

### 4. Generate stories

Call `generate_stories` with your crafted args. Use the `variants` field for state stories:
```json
{
  "dir": "./src/components",
  "components": ["TaskList"],
  "args": {
    "TaskList": {
      "Default": {
        "tasks": [{"id": "1", "title": "Task 1", "state": "TASK_INBOX"}],
        "loading": false
      },
      "variants": {
        "Loading": { "tasks": [], "loading": true },
        "Empty": { "tasks": [], "loading": false },
        "WithPinnedTasks": {
          "tasks": [
            {"id": "1", "title": "Task 1", "state": "TASK_INBOX"},
            {"id": "2", "title": "Pinned task", "state": "TASK_PINNED"}
          ],
          "loading": false
        }
      }
    }
  }
}
```

### 5. Validate

Call `validate_story` for each generated story. This checks TypeScript compilation.

Then call `test_story` — this goes deeper than `validate_story`, checking that all required props have args, object-typed args match the resolved interface shape, and enum/union values are valid. This catches runtime crashes before you start Storybook.

### 6. Fix errors (if any)

If validation fails:
1. Read the error message (e.g., "Cannot read properties of undefined (reading 'summary')")
2. Call `get_type_definition` for the failing type
3. Identify the missing/wrong field
4. Call `generate_stories` again with corrected args
5. Re-validate with both `validate_story` and `test_story`

Retry up to 3 times. If still failing, report the error to the user.

### 7. Report results

Tell the user:
- Which components got stories generated
- How many stories per component (Default + variants + state stories)
- Which providers were auto-detected and wrapped (from `requiredProviders`)
- Any validation errors that couldn't be auto-fixed

## Tips

- For simple components (all primitive props), you can skip `get_type_definition` and just use `suggest_args` as a quick shortcut.
- Skip function/callback props (onClick, onChange) — they become Storybook actions automatically.
- Skip `ReactNode` props like `children` — they don't need controls.
- If `find_usage_examples` returns real values, prefer those over generic placeholders.
- For connected components (Redux, React Query), the auto-injected decorator uses a minimal store. If the component reads specific state slices, the story will compile but may crash at runtime — warn the user they may need to enhance the mock store. See `/fix-story` for guidance.
