# Fix a Broken Storybook Story

You are diagnosing and fixing a Storybook story that crashes, has TypeScript errors, or has runtime failures.

## Workflow

### 1. Identify the problem

Start with both validation tools:
- Call `validate_story` — checks TypeScript compilation errors with line numbers.
- Call `test_story` — checks structural correctness: required props, object shapes, enum values, accessed nested paths.

If neither finds an issue, the problem is likely a **runtime error** (provider/context missing, data fetching, state management). See "Common Runtime Fixes" below.

### 2. Understand the component

Call `get_component` to see the full prop metadata — types, required/optional, defaults.

**Check `requiredProviders`** — this field tells you which context providers the component needs. If the runtime error is a missing context, this immediately tells you which provider is missing.

### 3. Resolve complex types

For each prop mentioned in the error, call `get_type_definition` to see the full interface tree. The most common failure is a complex prop (like `cartData: Cart`) receiving `{}` or a flat string instead of a properly-shaped nested object.

### 4. Check for real data

Call `get_mock_fixtures` to see if the project has existing mock data for the failing types. If fixtures exist, reuse them — they're already known to work.

Also check for Redux slice files (`*slice.ts`, `*store.ts`) — they contain the state shape and reducer logic needed for mock stores.

### 5. Fix and regenerate

**For TypeScript / structural errors:**

Call `generate_stories` with corrected args that match the resolved type definitions. Make sure every required field in every nested object is present.

**For runtime errors (provider/context/state):**

These can't be fixed through `generate_stories` alone. You need to read and edit the story file directly:

1. Read the generated `.stories.tsx` file.
2. Apply the fix based on the error type (see "Common Runtime Fixes" below).
3. Write the corrected file.

### 6. Verify the fix

Call `validate_story` and `test_story` again. If both pass, report success. If they fail with a new error, repeat from step 3.

## Common TypeScript Fixes

- **"Cannot read properties of undefined"** — A nested object or array is missing. Resolve the type and add the missing data.
- **"Type '{}' is not assignable to type 'X'"** — The object is empty. Fill in all required fields from the resolved type.
- **"Property 'X' is missing"** — A required field wasn't included. Add it.
- **Duplicate export names** — Two stories have the same name. This is a tool bug — report it.

## Common Runtime Fixes

These errors appear in the Storybook browser, not during TypeScript compilation:

### "could not find react-redux context value; please ensure the component is wrapped in a Provider"

**Cause:** Component uses `useSelector`, `useDispatch`, or `useStore` but the story has no Redux Provider decorator, or has one with an empty store.

**Fix:**
1. Check `get_component` — `requiredProviders` should include `"Redux"`.
2. If the decorator exists but has `configureStore({ reducer: {} })`, the store is empty. The component reads state that doesn't exist.
3. Find the Redux slice file (use `get_mock_fixtures` — look for `*slice.ts`). Read it to get the slice name, initial state, and reducers.
4. Edit the story to replace the empty store with a real one:
   ```typescript
   const MockedState = {
     tasks: [{ id: '1', title: 'Task 1', state: 'TASK_INBOX' }],
     status: 'idle',
     error: null,
   };

   const Mockstore = ({ taskboxState, children }) => (
     <Provider store={configureStore({
       reducer: {
         taskbox: createSlice({
           name: 'taskbox',
           initialState: taskboxState,
           reducers: { updateTaskState: (state, action) => { /* ... */ } },
         }).reducer,
       },
     })}>
       {children}
     </Provider>
   );
   ```
5. Use per-story decorators to provide different state:
   ```typescript
   export const Default: Story = {
     decorators: [(Story) => <Mockstore taskboxState={MockedState}><Story /></Mockstore>],
   };
   ```

### "useNavigate() may be used only in the context of a Router component"

**Cause:** Component uses React Router hooks but the story has no `<MemoryRouter>` wrapper.

**Fix:** The tool should auto-detect this. If it didn't:
1. Add `import { MemoryRouter } from 'react-router-dom';` to the story.
2. Add a decorator: `decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>]`
3. For components that use `useParams`, provide initial entries: `<MemoryRouter initialEntries={['/items/123']}>`

### "No QueryClient set, use QueryClientProvider to set one"

**Cause:** Component uses React Query hooks but has no `<QueryClientProvider>`.

**Fix:** The tool should auto-detect this. If it didn't:
1. Add `import { QueryClient, QueryClientProvider } from '@tanstack/react-query';`
2. Add a decorator: `decorators: [(Story) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Story /></QueryClientProvider>]`
3. Note: Queries will stay in loading state unless mocked. Recommend MSW for realistic data:
   ```typescript
   parameters: {
     msw: {
       handlers: [
         http.get('/api/data', () => HttpResponse.json(mockData)),
       ],
     },
   },
   ```

### "Cannot read properties of undefined (reading 'someSlice')" at runtime

**Cause:** The Redux store decorator exists but has an empty reducer. The component tries to read `state.someSlice.field` which is undefined.

**Fix:** Same as the Redux fix above — find the slice file, build a mock store with real initial state.

### Custom context errors (e.g., "useAuth must be used within an AuthProvider")

**Cause:** Component uses a project-specific context provider that can't be auto-configured.

**Fix:**
1. Find the provider source file (look for the provider name in the import paths).
2. Read the provider to understand what value/state it expects.
3. Either:
   - Import and wrap the real provider in the story decorator (if it has no external dependencies).
   - Create a mock provider with the expected context shape.
   - Add it to `.storybook/preview.ts` as a global decorator if many components need it.
