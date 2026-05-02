export type ParsedIssueKey = {
  org?: string;
  key: string;
  projectKey: string;
};

const ISSUE_KEY_RE = /^([A-Z][A-Z0-9_]*)-\d+$/;
const ORG_PART_RE = /^[a-zA-Z0-9_.-]+$/;

export function parseIssueKey(input: string): ParsedIssueKey {
  const slashIdx = input.indexOf('/');
  let org: string | undefined;
  let rest = input;
  if (slashIdx !== -1) {
    org = input.slice(0, slashIdx);
    rest = input.slice(slashIdx + 1);
    if (!org || !ORG_PART_RE.test(org)) {
      throw new Error(`Invalid org prefix in "${input}". Use letters, digits, _, ., -.`);
    }
  }
  const upperRest = rest.toUpperCase();
  const match = ISSUE_KEY_RE.exec(upperRest);
  if (!match) {
    throw new Error(
      `Invalid issue key "${input}". Expected PROJECT-123 or org/PROJECT-123.`
    );
  }
  return { org, key: upperRest, projectKey: match[1] };
}

export type ResolvedKeys = {
  org?: string;
  projectKey: string;
  keys: string[];
};

export function parseIssueKeyArgs(inputs: string[]): ResolvedKeys {
  if (inputs.length === 0) throw new Error('No issue keys provided.');
  const parsed = inputs.map(parseIssueKey);

  const projectKey = parsed[0].projectKey;
  for (const p of parsed) {
    if (p.projectKey !== projectKey) {
      throw new Error(
        `All issue keys must share the same project prefix. Got "${parsed[0].key}" and "${p.key}". ` +
          'Run jirallm separately for each project, or pass --org/--project explicitly.'
      );
    }
  }

  const orgs = parsed
    .map((p) => p.org)
    .filter((o): o is string => o !== undefined);
  let org: string | undefined;
  if (orgs.length > 0) {
    const first = orgs[0];
    for (const o of orgs) {
      if (o !== first) {
        throw new Error(
          `Mixed org prefixes in issue keys ("${first}" vs "${o}"). All keys must share the same org/.`
        );
      }
    }
    if (orgs.length !== parsed.length) {
      throw new Error(
        'When using the org/KEY syntax, all issue keys must include the same org/ prefix.'
      );
    }
    org = first;
  }

  return { org, projectKey, keys: parsed.map((p) => p.key) };
}
