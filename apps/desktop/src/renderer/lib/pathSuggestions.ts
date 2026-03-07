import type { IpcResponse } from "@filetrail/contracts";

import type { TreeNodeState } from "../components/TreePane";

type PathSuggestionsResponse = IpcResponse<"path:getSuggestions">;

export function getLocalPathSuggestions(args: {
  inputPath: string;
  includeHidden: boolean;
  limit: number;
  treeNodes: Record<string, TreeNodeState>;
}): PathSuggestionsResponse | null {
  const { includeHidden, inputPath, limit, treeNodes } = args;
  const trimmedInput = inputPath.trim();
  const normalizedInput = normalizePath(trimmedInput.length === 0 ? "/" : trimmedInput);
  const trailingSlash = /[\\/]$/.test(trimmedInput);

  for (const candidate of buildSuggestionCandidates(normalizedInput, trailingSlash)) {
    const node = treeNodes[candidate.basePath];
    if (!node?.loaded) {
      continue;
    }
    const suggestions = node.childPaths
      .map((path) => treeNodes[path])
      .filter((child): child is TreeNodeState => child !== undefined)
      .filter((child) => includeHidden || !child.isHidden)
      .filter((child) =>
        candidate.typedName.length === 0
          ? true
          : child.name.toLowerCase().startsWith(candidate.typedName.toLowerCase()),
      )
      .map((child) => ({
        path: child.path,
        name: child.name,
        isDirectory: true,
      }))
      .sort(compareSuggestionsByName)
      .slice(0, limit);

    return {
      inputPath,
      basePath: candidate.basePath,
      suggestions,
    };
  }

  return null;
}

export function mergePathSuggestions(args: {
  primary: PathSuggestionsResponse | null;
  secondary: PathSuggestionsResponse;
  limit: number;
}): PathSuggestionsResponse {
  const { limit, primary, secondary } = args;
  if (!primary) {
    return secondary;
  }

  const seenPaths = new Set<string>();
  const merged = [...primary.suggestions, ...secondary.suggestions].filter((suggestion) => {
    if (seenPaths.has(suggestion.path)) {
      return false;
    }
    seenPaths.add(suggestion.path);
    return true;
  });

  return {
    inputPath: secondary.inputPath,
    basePath: primary.basePath ?? secondary.basePath,
    suggestions: merged.sort(compareSuggestionsByName).slice(0, limit),
  };
}

function buildSuggestionCandidates(
  normalizedInput: string,
  trailingSlash: boolean,
): Array<{ basePath: string; typedName: string }> {
  const candidates: Array<{ basePath: string; typedName: string }> = [];
  let currentPath = normalizedInput;
  let currentTrailingSlash = trailingSlash;

  while (true) {
    if (currentTrailingSlash) {
      candidates.push({ basePath: currentPath, typedName: "" });
      if (currentPath === "/") {
        break;
      }
      const parentPath = parentDirectoryPath(currentPath);
      candidates.push({
        basePath: parentPath,
        typedName: basename(currentPath),
      });
      currentPath = parentPath;
      currentTrailingSlash = false;
      continue;
    }

    const parentPath = parentDirectoryPath(currentPath);
    candidates.push({
      basePath: parentPath,
      typedName: basename(currentPath),
    });
    if (parentPath === "/") {
      candidates.push({ basePath: "/", typedName: basename(parentPath) });
      break;
    }
    currentPath = parentPath;
  }

  return dedupeCandidates(candidates);
}

function dedupeCandidates(
  candidates: Array<{ basePath: string; typedName: string }>,
): Array<{ basePath: string; typedName: string }> {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.basePath}::${candidate.typedName}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizePath(path: string): string {
  if (path === "/") {
    return "/";
  }
  const parts = path.split("/").filter((part) => part.length > 0);
  return `/${parts.join("/")}`;
}

function parentDirectoryPath(path: string): string {
  if (path === "/") {
    return "/";
  }
  const parts = path.split("/").filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return "/";
  }
  return `/${parts.slice(0, -1).join("/")}`;
}

function basename(path: string): string {
  if (path === "/") {
    return "";
  }
  return (
    path
      .split("/")
      .filter((part) => part.length > 0)
      .at(-1) ?? ""
  );
}

function compareSuggestionsByName(
  left: PathSuggestionsResponse["suggestions"][number],
  right: PathSuggestionsResponse["suggestions"][number],
): number {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
