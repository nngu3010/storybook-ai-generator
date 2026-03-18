import {
  Project,
  SourceFile,
  Type,
  Symbol as MorphSymbol,
  Node,
  SyntaxKind,
  FunctionDeclaration,
  VariableDeclaration,
  ArrowFunction,
  FunctionExpression,
  ParameterDeclaration,
  JSDocableNode,
  CallExpression,
} from 'ts-morph';

export interface PropMeta {
  name: string;
  typeName: string;        // raw TypeScript type string
  required: boolean;
  defaultValue?: string;
  description?: string;    // from JSDoc
  deprecated?: boolean;
}

export interface ComponentMeta {
  name: string;            // component display name
  filePath: string;
  props: PropMeta[];
  skipReason?: string;     // if component should be skipped
}

/**
 * Parses a single component file and extracts its prop metadata.
 */
export function parseComponent(project: Project, filePath: string): ComponentMeta {
  const sourceFile = project.getSourceFile(filePath);
  if (!sourceFile) {
    return {
      name: fileBaseName(filePath),
      filePath,
      props: [],
      skipReason: `Source file not found in project: ${filePath}`,
    };
  }

  const defaultExport = findDefaultExport(sourceFile);
  if (!defaultExport) {
    return {
      name: fileBaseName(filePath),
      filePath,
      props: [],
      skipReason: 'No default export found',
    };
  }

  const componentName = resolveComponentName(defaultExport, filePath);

  // Detect HOC: if the function returns another function/component
  if (isHoc(defaultExport)) {
    return {
      name: componentName,
      filePath,
      props: [],
      skipReason: 'Component appears to be a Higher-Order Component (HOC)',
    };
  }

  const firstParam = getFirstParameter(defaultExport);
  if (!firstParam) {
    // No props — valid component
    return { name: componentName, filePath, props: [] };
  }

  // Extract default values from destructuring pattern
  const defaultValues = extractDefaultValues(firstParam);

  // Resolve the props type
  const paramType = firstParam.getType();
  const props = extractProps(paramType, sourceFile, defaultValues);

  return { name: componentName, filePath, props };
}

// ---------------------------------------------------------------------------
// Finding the default export
// ---------------------------------------------------------------------------

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

function findDefaultExport(sourceFile: SourceFile): FunctionLike | null {
  // export default function Foo() {}
  for (const fn of sourceFile.getFunctions()) {
    if (fn.isDefaultExport()) return fn;
  }

  // export default Foo  (where Foo is defined as const Foo = ...)
  const defaultExportSymbol = sourceFile.getDefaultExportSymbol();
  if (!defaultExportSymbol) return null;

  const declarations = defaultExportSymbol.getDeclarations();
  for (const decl of declarations) {
    if (Node.isFunctionDeclaration(decl)) return decl;
    if (Node.isExportAssignment(decl)) {
      const expr = decl.getExpression();
      if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) return expr;
      // Identifier pointing to a variable
      if (Node.isIdentifier(expr)) {
        const referenced = resolveIdentifier(expr, sourceFile);
        if (referenced) return referenced;
      }
      // React.forwardRef(...) or React.memo(...)
      if (Node.isCallExpression(expr)) {
        const unwrapped = unwrapWrappers(expr, sourceFile);
        if (unwrapped) return unwrapped;
      }
    }
  }

  // const Foo = () => {} with export default Foo or export { Foo as default }
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    const init = varDecl.getInitializer();
    if (!init) continue;

    const isDefaultExport = (() => {
      const name = varDecl.getName();
      const exported = sourceFile.getDefaultExportSymbol();
      if (!exported) return false;
      const exportedName = exported.getName();
      return exportedName === name || exportedName === 'default';
    })();

    if (!isDefaultExport) continue;

    if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
      return init as ArrowFunction | FunctionExpression;
    }
    // const Foo = React.forwardRef(...) or React.memo(...)
    if (Node.isCallExpression(init)) {
      const unwrapped = unwrapWrappers(init, sourceFile);
      if (unwrapped) return unwrapped;
    }
  }

  return null;
}

function resolveIdentifier(
  identifier: Node,
  sourceFile: SourceFile
): FunctionLike | null {
  const name = identifier.getText();
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    if (varDecl.getName() === name) {
      const init = varDecl.getInitializer();
      if (!init) continue;
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
        return init as ArrowFunction | FunctionExpression;
      }
      if (Node.isCallExpression(init)) {
        const unwrapped = unwrapWrappers(init, sourceFile);
        if (unwrapped) return unwrapped;
      }
    }
  }
  for (const fn of sourceFile.getFunctions()) {
    if (fn.getName() === name) return fn;
  }
  return null;
}

// ---------------------------------------------------------------------------
// forwardRef / memo unwrapping
// ---------------------------------------------------------------------------

/**
 * Unwraps React.forwardRef(...) and React.memo(...) call expressions,
 * recursively handling combinations like React.memo(React.forwardRef(...)).
 */
function unwrapWrappers(call: CallExpression, sourceFile: SourceFile): FunctionLike | null {
  const calleeText = call.getExpression().getText();

  if (/^(React\.)?forwardRef$/.test(calleeText)) {
    const args = call.getArguments();
    if (args.length === 0) return null;
    const renderFn = args[0];
    if (Node.isArrowFunction(renderFn) || Node.isFunctionExpression(renderFn)) {
      return renderFn as ArrowFunction | FunctionExpression;
    }
    if (Node.isIdentifier(renderFn)) {
      return resolveIdentifier(renderFn, sourceFile);
    }
  }

  if (/^(React\.)?memo$/.test(calleeText)) {
    const args = call.getArguments();
    if (args.length === 0) return null;
    const component = args[0];
    if (Node.isArrowFunction(component) || Node.isFunctionExpression(component)) {
      return component as ArrowFunction | FunctionExpression;
    }
    if (Node.isIdentifier(component)) {
      return resolveIdentifier(component, sourceFile);
    }
    // memo(forwardRef(...))
    if (Node.isCallExpression(component)) {
      return unwrapWrappers(component, sourceFile);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// HOC detection
// ---------------------------------------------------------------------------

function isHoc(fn: FunctionLike): boolean {
  // A HOC returns a function/component. Heuristic: check return type text.
  const returnType = fn.getReturnType();
  const returnTypeText = returnType.getText();
  // If return type is a function type, it's a HOC
  if (/^\(.*\)\s*=>/.test(returnTypeText)) return true;
  // If the function body explicitly returns a function declaration
  const body = Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)
    ? fn.getBody()
    : (fn as FunctionDeclaration).getBody();
  if (!body) return false;
  const bodyText = body.getText();
  if (/return\s+function\s+[A-Z]/.test(bodyText)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Getting first parameter
// ---------------------------------------------------------------------------

function getFirstParameter(fn: FunctionLike): ParameterDeclaration | null {
  const params = fn.getParameters();
  if (params.length === 0) return null;
  return params[0];
}

// ---------------------------------------------------------------------------
// Extracting default values from destructured parameter
// ---------------------------------------------------------------------------

function extractDefaultValues(param: ParameterDeclaration): Map<string, string> {
  const defaults = new Map<string, string>();
  const nameNode = param.getNameNode();
  if (!Node.isObjectBindingPattern(nameNode)) return defaults;

  for (const element of nameNode.getElements()) {
    const init = element.getInitializer();
    if (init) {
      const propName = element.getPropertyNameNode()?.getText() ?? element.getName();
      defaults.set(propName, init.getText());
    }
  }
  return defaults;
}

// ---------------------------------------------------------------------------
// Extracting props from a type
// ---------------------------------------------------------------------------

function extractProps(
  type: Type,
  sourceFile: SourceFile,
  defaults: Map<string, string>
): PropMeta[] {
  // Unwrap React.FC<Props> — the type callable signature
  const unwrapped = unwrapReactFc(type);

  // Handle intersection types: merge all properties
  if (unwrapped.isIntersection()) {
    const allProps: PropMeta[] = [];
    const seen = new Set<string>();
    for (const t of unwrapped.getIntersectionTypes()) {
      for (const prop of extractPropsFromType(t, sourceFile, defaults)) {
        if (!seen.has(prop.name)) {
          seen.add(prop.name);
          allProps.push(prop);
        }
      }
    }
    return allProps;
  }

  return extractPropsFromType(unwrapped, sourceFile, defaults);
}

function extractPropsFromType(
  type: Type,
  sourceFile: SourceFile,
  defaults: Map<string, string>
): PropMeta[] {
  const props: PropMeta[] = [];
  const properties = type.getProperties();

  for (const sym of properties) {
    const propMeta = symbolToPropMeta(sym, sourceFile, defaults);
    if (propMeta) props.push(propMeta);
  }

  return props;
}

function unwrapReactFc(type: Type): Type {
  // React.FC<Props> is a callable type — try to get type args
  const typeText = type.getText();
  if (/React\.FC<|React\.FunctionComponent<|FC<|FunctionComponent</.test(typeText)) {
    const typeArgs = type.getTypeArguments();
    if (typeArgs.length > 0) return typeArgs[0];
  }
  return type;
}

/**
 * Expands type aliases whose underlying type is a union of string/number/boolean
 * literals (e.g. `type Variant = 'a' | 'b'` → `"a" | "b"`).
 * Falls back to the default getText() representation for everything else.
 */
/**
 * Expands type aliases whose underlying type is a union of string/number literals
 * (e.g. `type Variant = 'a' | 'b'` → `"a" | "b"`).
 * Skips pure boolean aliases (`true | false`) since `boolean` is already handled
 * by the type mapper and expanding it would break the `control: 'boolean'` path.
 * Falls back to the default getText() representation for everything else.
 */
function expandTypeAlias(type: Type, sourceFile: SourceFile): string {
  // Strip optional wrapper (undefined) to check the base type
  const baseType = type.getNonNullableType();
  if (baseType.isUnion()) {
    const members = baseType.getUnionTypes();
    // Skip pure boolean unions (true | false) — let the mapper handle 'boolean'
    const nonBool = members.filter((t) => !t.isBooleanLiteral());
    if (nonBool.length === 0) return type.getText(sourceFile);

    const isAllLiterals = members.every(
      (t) => t.isStringLiteral() || t.isNumberLiteral() || t.isBooleanLiteral() || t.isUndefined() || t.isNull()
    );
    if (isAllLiterals) {
      // Re-use the full type (including undefined for optional) for the text
      return type.getUnionTypes().map((t) => t.getText(sourceFile)).join(' | ');
    }
  }
  return type.getText(sourceFile);
}

function symbolToPropMeta(
  sym: MorphSymbol,
  sourceFile: SourceFile,
  defaults: Map<string, string>
): PropMeta | null {
  const name = sym.getName();

  // Skip internal TS symbols and common React internal props we don't care about
  if (name.startsWith('__') || name === 'displayName') return null;

  const declarations = sym.getDeclarations();
  const firstDecl = declarations[0];

  // Determine type
  const type = sym.getTypeAtLocation(firstDecl ?? sourceFile);
  const typeName = expandTypeAlias(type, sourceFile);

  // Required: not optional and no default
  const isOptional = sym.isOptional();
  const hasDefault = defaults.has(name);
  const required = !isOptional && !hasDefault;

  // Default value
  const defaultValue = defaults.get(name);

  // JSDoc description and @deprecated
  let description: string | undefined;
  let deprecated = false;

  if (firstDecl && 'getJsDocs' in firstDecl) {
    const jsDocs = (firstDecl as unknown as JSDocableNode).getJsDocs();
    for (const doc of jsDocs) {
      const comment = doc.getComment();
      if (comment) {
        description = typeof comment === 'string'
          ? comment
          : comment.map((c) => (c ? c.getText() : '')).join('');
      }
      for (const tag of doc.getTags()) {
        if (tag.getTagName() === 'deprecated') {
          deprecated = true;
          const tagComment = tag.getComment();
          if (tagComment && !description) {
            description = typeof tagComment === 'string'
              ? tagComment
              : tagComment.map((c) => (c ? c.getText() : '')).join('');
          }
        }
        if (tag.getTagName() === 'param' || tag.getTagName() === 'description') {
          const tagComment = tag.getComment();
          if (tagComment && !description) {
            description = typeof tagComment === 'string'
              ? tagComment
              : tagComment.map((c) => (c ? c.getText() : '')).join('');
          }
        }
      }
    }
  }

  // Filter out props that come from node_modules type definitions
  // (e.g., HTMLAttributes, DOMAttributes) unless they're in our source
  if (isFromNodeModules(firstDecl)) return null;

  return {
    name,
    typeName,
    required,
    defaultValue,
    description: description?.trim(),
    deprecated,
  };
}

function isFromNodeModules(node: Node | undefined): boolean {
  if (!node) return false;
  const srcFile = node.getSourceFile();
  const filePath = srcFile.getFilePath();
  return filePath.includes('node_modules');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileBaseName(filePath: string): string {
  return filePath.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') ?? 'Unknown';
}

function resolveComponentName(fn: FunctionLike, filePath: string): string {
  if (Node.isFunctionDeclaration(fn)) {
    return fn.getName() ?? fileBaseName(filePath);
  }
  // Arrow or function expression — walk up to find variable name.
  // Handles: const Foo = () => ...
  //          const Foo = React.forwardRef((props, ref) => ...)
  //          const Foo = React.memo(React.forwardRef(...))
  let node: Node = fn;
  while (node) {
    const parent = node.getParent();
    if (!parent) break;
    if (Node.isVariableDeclaration(parent)) {
      return parent.getName();
    }
    // Keep walking up through CallExpression wrappers
    if (Node.isCallExpression(parent)) {
      node = parent;
      continue;
    }
    break;
  }
  return fileBaseName(filePath);
}
