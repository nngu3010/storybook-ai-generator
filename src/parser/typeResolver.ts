import {
  Project,
  Type,
  SourceFile,
  Node,
} from 'ts-morph';
import path from 'path';
import { findComponents } from '../detector/componentFinder.js';
import { buildProgram } from './programBuilder.js';
import type { PropMeta } from './componentParser.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ResolvedProperty {
  type: string;
  required: boolean;
  description?: string;
  resolved?: ResolvedTypeDefinition;
}

export interface ResolvedTypeDefinition {
  name: string;
  kind: 'interface' | 'type-alias' | 'enum' | 'union' | 'primitive' | 'array' | 'tuple' | 'function' | 'unknown';
  properties?: Record<string, ResolvedProperty>;
  unionMembers?: string[];
  enumMembers?: Array<{ name: string; value: string | number }>;
  elementType?: ResolvedTypeDefinition;
  text?: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const MAX_DEPTH = 6;

/**
 * Resolve a TypeScript type by name from a project directory.
 * Recursively walks nested types up to MAX_DEPTH levels.
 */
export async function resolveTypeDefinition(
  dir: string,
  typeName: string,
  maxDepth: number = MAX_DEPTH,
): Promise<ResolvedTypeDefinition | null> {
  const resolvedDir = path.resolve(dir);
  const componentFiles = await findComponents(resolvedDir);
  const project = buildProgram(resolvedDir, componentFiles);

  // Also add any .ts files (not just components) to broaden type coverage
  addTypeFiles(project, resolvedDir);

  return resolveTypeDefinitionFromProject(project, typeName, maxDepth);
}

/**
 * Resolve a TypeScript type by name using an existing ts-morph Project.
 * Synchronous — avoids rebuilding the project per call.
 */
export function resolveTypeDefinitionFromProject(
  project: Project,
  typeName: string,
  maxDepth: number = MAX_DEPTH,
): ResolvedTypeDefinition | null {
  for (const sf of project.getSourceFiles()) {
    // Check interfaces
    const iface = sf.getInterface(typeName);
    if (iface) {
      const type = iface.getType();
      return resolveType(type, sf, typeName, maxDepth, new Set());
    }

    // Check type aliases
    const typeAlias = sf.getTypeAlias(typeName);
    if (typeAlias) {
      const type = typeAlias.getType();
      return resolveType(type, sf, typeName, maxDepth, new Set());
    }

    // Check enums
    const enumDecl = sf.getEnum(typeName);
    if (enumDecl) {
      const members = enumDecl.getMembers().map((m) => ({
        name: m.getName(),
        value: m.getValue() ?? m.getName(),
      }));
      return { name: typeName, kind: 'enum', enumMembers: members };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Recursive type resolution
// ---------------------------------------------------------------------------

function resolveType(
  type: Type,
  sourceFile: SourceFile,
  name: string,
  depth: number,
  seen: Set<string>,
): ResolvedTypeDefinition {
  // Prevent infinite recursion
  const typeId = type.getText(sourceFile);
  if (seen.has(typeId) || depth <= 0) {
    return { name, kind: 'unknown', text: typeId };
  }
  seen = new Set(seen);
  seen.add(typeId);

  // Strip optional wrappers (T | undefined) to resolve the base type
  if (type.isUnion()) {
    const members = type.getUnionTypes();
    const nonNullMembers = members.filter((m) => !m.isUndefined() && !m.isNull());
    if (nonNullMembers.length === 1 && nonNullMembers.length < members.length) {
      // This is an optional type like T | undefined — resolve T
      return resolveType(nonNullMembers[0], sourceFile, name, depth, seen);
    }
  }

  // Primitives
  if (type.isString() || type.isStringLiteral()) {
    return { name, kind: 'primitive', text: type.getText(sourceFile) };
  }
  if (type.isNumber() || type.isNumberLiteral()) {
    return { name, kind: 'primitive', text: type.getText(sourceFile) };
  }
  if (type.isBoolean() || type.isBooleanLiteral()) {
    return { name, kind: 'primitive', text: type.getText(sourceFile) };
  }
  if (type.isNull() || type.isUndefined()) {
    return { name, kind: 'primitive', text: type.getText(sourceFile) };
  }

  // Union types
  if (type.isUnion()) {
    const members = type.getUnionTypes();
    const allLiterals = members.every(
      (m) => m.isStringLiteral() || m.isNumberLiteral() || m.isBooleanLiteral() || m.isNull() || m.isUndefined()
    );
    if (allLiterals) {
      return {
        name,
        kind: 'union',
        unionMembers: members.map((m) => m.getText(sourceFile)),
      };
    }

    // Complex union — resolve each member
    return {
      name,
      kind: 'union',
      unionMembers: members.map((m) => m.getText(sourceFile)),
    };
  }

  // Enum literal (already handled in union case above, but just in case)
  if (type.isEnumLiteral() || type.isEnum()) {
    const enumMembers: Array<{ name: string; value: string | number }> = [];
    const symbol = type.getSymbol() ?? type.getAliasSymbol();
    if (symbol) {
      for (const decl of symbol.getDeclarations()) {
        if (Node.isEnumDeclaration(decl)) {
          for (const m of decl.getMembers()) {
            enumMembers.push({
              name: m.getName(),
              value: m.getValue() ?? m.getName(),
            });
          }
        }
      }
    }
    return { name, kind: 'enum', enumMembers };
  }

  // Arrays
  if (type.isArray()) {
    const elementType = type.getArrayElementTypeOrThrow();
    const elementName = getTypeName(elementType, sourceFile);
    const resolved = resolveType(elementType, sourceFile, elementName, depth - 1, seen);
    return { name, kind: 'array', elementType: resolved };
  }

  // Tuples
  if (type.isTuple()) {
    return { name, kind: 'tuple', text: type.getText(sourceFile) };
  }

  // Function types
  const callSignatures = type.getCallSignatures();
  if (callSignatures.length > 0 && type.getProperties().length === 0) {
    return { name, kind: 'function', text: type.getText(sourceFile) };
  }

  // Object / interface types — resolve properties
  const properties = type.getProperties();
  if (properties.length > 0) {
    const resolvedProps: Record<string, ResolvedProperty> = {};

    for (const prop of properties) {
      const propName = prop.getName();
      if (propName.startsWith('__')) continue;

      const declarations = prop.getDeclarations();
      const firstDecl = declarations[0];

      // Skip node_modules types
      if (firstDecl) {
        const filePath = firstDecl.getSourceFile().getFilePath();
        if (filePath.includes('node_modules')) continue;
      }

      const propType = prop.getTypeAtLocation(firstDecl ?? sourceFile);
      const isOptional = prop.isOptional();
      const propTypeName = getTypeName(propType, sourceFile);

      // Get JSDoc description
      let description: string | undefined;
      if (firstDecl && 'getJsDocs' in firstDecl) {
        const jsDocs = (firstDecl as any).getJsDocs();
        for (const doc of jsDocs) {
          const comment = doc.getComment();
          if (comment) {
            description = typeof comment === 'string'
              ? comment
              : comment.map((c: any) => (c ? c.getText() : '')).join('');
          }
        }
      }

      // Decide whether to recurse
      const shouldResolve = !propType.isString() && !propType.isNumber() && !propType.isBoolean()
        && !propType.isNull() && !propType.isUndefined()
        && !propType.isStringLiteral() && !propType.isNumberLiteral() && !propType.isBooleanLiteral()
        && propType.getProperties().length > 0
        || propType.isArray()
        || (propType.isUnion() && !propType.getUnionTypes().every((m) =>
            m.isStringLiteral() || m.isNumberLiteral() || m.isBooleanLiteral() || m.isNull() || m.isUndefined()
          ));

      const entry: ResolvedProperty = {
        type: propType.getText(sourceFile),
        required: !isOptional,
        ...(description ? { description: description.trim() } : {}),
      };

      if (shouldResolve && depth > 1) {
        const resolved = resolveType(propType, sourceFile, propTypeName, depth - 1, seen);
        if (resolved.kind !== 'primitive' && resolved.kind !== 'unknown') {
          entry.resolved = resolved;
        }
      }

      resolvedProps[propName] = entry;
    }

    return { name, kind: 'interface', properties: resolvedProps };
  }

  return { name, kind: 'unknown', text: type.getText(sourceFile) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTypeName(type: Type, sourceFile: SourceFile): string {
  const symbol = type.getSymbol() ?? type.getAliasSymbol();
  if (symbol) return symbol.getName();

  const text = type.getText(sourceFile);
  // Clean up long type texts
  if (text.length > 50) return text.slice(0, 50) + '...';
  return text;
}

// ---------------------------------------------------------------------------
// Shared prop type resolution (used by both CLI and MCP)
// ---------------------------------------------------------------------------

/**
 * Resolve complex prop types using a ts-morph Project.
 * Returns a Map from type name to its resolved definition.
 * Uses a cache across the entire run to avoid redundant resolution.
 */
export function resolvePropsTypes(
  props: PropMeta[],
  project: Project,
  cache: Map<string, ResolvedTypeDefinition | null>,
): Map<string, ResolvedTypeDefinition> {
  const result = new Map<string, ResolvedTypeDefinition>();

  for (const prop of props) {
    const typeName = extractTypeName(prop.typeName);
    if (!typeName || result.has(typeName)) continue;

    if (cache.has(typeName)) {
      const cached = cache.get(typeName);
      if (cached) result.set(typeName, cached);
      continue;
    }

    const resolved = resolveTypeDefinitionFromProject(project, typeName);
    cache.set(typeName, resolved);
    if (resolved) result.set(typeName, resolved);
  }

  return result;
}

/**
 * Extract the base named type from a type string.
 * Returns null for primitives, functions, React types, etc.
 */
export function extractTypeName(typeName: string): string | null {
  let clean = typeName.trim();
  // Strip nullable
  clean = clean.split('|').map(t => t.trim()).filter(t => t !== 'undefined' && t !== 'null').join(' | ');
  // Strip array suffix
  if (clean.endsWith('[]')) clean = clean.slice(0, -2);
  const arrayMatch = clean.match(/^Array<(.+)>$/);
  if (arrayMatch) clean = arrayMatch[1];
  clean = clean.trim();

  // Skip primitives, functions, React types, unions, intersections
  const skip = ['string', 'number', 'boolean', 'any', 'unknown', 'never', 'void', 'null', 'undefined'];
  if (skip.includes(clean)) return null;
  if (/^['"]/.test(clean) || /^\(/.test(clean)) return null;
  if (clean.includes(' | ') || clean.includes(' & ')) return null;
  if (/^(React\.|JSX\.)/.test(clean)) return null;
  if (/^Record</.test(clean) || /^\{/.test(clean)) return null;
  if (/\b(ReactNode|ReactElement|LucideIcon|IconType|ComponentType|FC|FunctionComponent|ElementType|ForwardRefExoticComponent)\b/.test(clean)) return null;
  if (!/^[A-Z]/.test(clean)) return null;

  return clean;
}

/**
 * Add common type definition files (.ts, not .tsx) to broaden type coverage
 * beyond just component files.
 */
export function addTypeFiles(project: Project, dir: string): void {
  try {
    const { glob } = require('glob');
    // Synchronous glob for simplicity
    const files: string[] = glob.sync('**/*.{ts,tsx}', {
      cwd: dir,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.*', '**/*.spec.*', '**/*.stories.*'],
      absolute: true,
    });
    for (const f of files) {
      try {
        project.addSourceFileAtPath(f);
      } catch {
        // File may already be in the project
      }
    }
  } catch {
    // glob not available, skip
  }
}
