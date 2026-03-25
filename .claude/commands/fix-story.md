# Fix a Broken Storybook Story

You are diagnosing and fixing a Storybook story that crashes or has TypeScript errors.

## Workflow

### 1. Identify the problem

Call `validate_story` with the component name to get the specific error:
- TypeScript compilation errors with line numbers
- Missing type information
- Incorrect prop shapes

### 2. Understand the component

Call `get_component` to see the full prop metadata — types, required/optional, defaults.

### 3. Resolve complex types

For each prop mentioned in the error, call `get_type_definition` to see the full interface tree. The most common failure is a complex prop (like `cartData: Cart`) receiving `{}` or a flat string instead of a properly-shaped nested object.

### 4. Check for real data

Call `get_mock_fixtures` to see if the project has existing mock data for the failing types. If fixtures exist, reuse them — they're already known to work.

### 5. Fix and regenerate

Call `generate_stories` with corrected args that match the resolved type definitions. Make sure every required field in every nested object is present.

### 6. Verify the fix

Call `validate_story` again. If it passes, report success. If it fails with a new error, repeat from step 3.

## Common Fixes

- **"Cannot read properties of undefined"** — A nested object or array is missing. Resolve the type and add the missing data.
- **"Type '{}' is not assignable to type 'X'"** — The object is empty. Fill in all required fields from the resolved type.
- **"Property 'X' is missing"** — A required field wasn't included. Add it.
- **Duplicate export names** — Two stories have the same name. This is a tool bug — report it.
