import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type FieldsOptions = {
  org: string;
  project?: string;
  type?: string;
  json?: boolean;
};

export async function runFields(opts: FieldsOptions): Promise<void> {
  const profile = await loadProfile({ org: opts.org, project: opts.project });
  const client = new JiraClient(profile.config, profile.apiToken);
  const projectKey = opts.project ?? profile.project.key;

  // With --type: show create-screen fields (incl. allowed select values) for that issue type.
  if (opts.type) {
    const fields = await client.getCreateFields(projectKey, opts.type);
    const custom = fields.filter((f) => f.fieldId.startsWith('customfield_'));

    if (shouldOutputJson(opts)) {
      printJson(custom);
      return;
    }
    if (custom.length === 0) {
      console.log(`No custom fields on the ${opts.type} create screen.`);
      return;
    }
    console.log(`${custom.length} custom field(s) on the ${opts.type} create screen:`);
    for (const f of custom) {
      const req = f.required ? ' (required)' : '';
      console.log(`  ${f.name} [${f.fieldId}]${req}`);
      if (f.allowedValues?.length) {
        console.log(`    options: ${f.allowedValues.join(', ')}`);
      }
    }
    return;
  }

  // Default: list all custom fields with their ids (use these in --field).
  const all = await client.listFields();
  const custom = all.filter((f) => f.custom);

  if (shouldOutputJson(opts)) {
    printJson(custom);
    return;
  }
  if (custom.length === 0) {
    console.log('No custom fields found.');
    return;
  }
  console.log(`${custom.length} custom field(s):`);
  for (const f of custom) {
    console.log(`  ${f.name} [${f.id}]`);
  }
  console.log('\nUse --type <issueType> to see allowed values for select fields.');
}
