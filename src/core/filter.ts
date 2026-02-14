function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function patternToRegex(pattern: string): RegExp {
  let source = "^"
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        source += ".*"
        i += 1
      } else {
        source += "[^/]*"
      }
    } else if (ch === "?") {
      source += "."
    } else {
      source += escapeRegex(ch)
    }
  }
  source += "$"
  return new RegExp(source)
}

export function matchesAnyPattern(value: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false
  }
  return patterns.some((pattern) => patternToRegex(pattern).test(value))
}

export function shouldIncludePath(value: string, include: string[], exclude: string[]): boolean {
  if (include.length > 0 && !matchesAnyPattern(value, include)) {
    return false
  }
  if (exclude.length > 0 && matchesAnyPattern(value, exclude)) {
    return false
  }
  return true
}
