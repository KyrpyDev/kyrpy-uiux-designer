/**
 * The global unique prefix of a new project: asked once when the project is created (2-16 lowercase letters or digits).
 * Every public item dropped onto one of its screens is then named `prefix-[itemtype]-itemname`.
 */
import { promptBox } from '../dom.js';
import { isValidProjectPrefix } from '/domain/naming.js';

export function suggestProjectPrefix(projectName = '') {
  const s = String(projectName).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^[^a-z]+/, '').slice(0, 16);
  return s.length >= 2 ? s : 'project';
}

/** Asks for the prefix; resolves to the prefix, or null when the user cancels. Re-asks until it is valid. */
export async function askProjectPrefix(projectName = '') {
  let value = suggestProjectPrefix(projectName);
  for (;;) {
    const answer = await promptBox('Project prefix', {
      value, okLabel: 'Set prefix',
      label: 'Global unique prefix of this project: 2-16 lowercase letters or digits, starting with a letter. It is set once and cannot be changed later.'
    });
    if (answer == null) return null;
    const p = String(answer).trim().toLowerCase();
    if (isValidProjectPrefix(p)) return p;
    value = p;
  }
}
