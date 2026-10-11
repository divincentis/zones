import { describe, expect, it } from 'vitest';
import { DEFAULT_FORM_STATE } from '../src/lib/buildModel';
import {
  checkProject,
  DEFAULT_PROJECT,
  parseProject,
  projectFileName,
  projectFromFragment,
  projectToFragment,
  serializeProject,
  type Project,
} from '../src/lib/project';
import { BUILDINGS, formWith } from './fixtures';

const project = (overrides = {}, boardSize: number | null = null): Project => ({ form: formWith(overrides), boardSize });
const ok = (check: ReturnType<typeof checkProject> | null): Project => {
  if (!check || !check.ok) throw new Error(check ? check.error : 'nothing read');
  return check.project;
};
const errorOf = (check: ReturnType<typeof checkProject> | null): string => {
  if (!check || check.ok) throw new Error('expected a refusal');
  return check.error;
};

describe('checkProject', () => {
  it('accepts a complete project unchanged', () => {
    const p = project({ roofType: 'gable', pitchDegrees: 22.5, projectName: 'Warehouse B' }, 4);
    expect(ok(checkProject(p))).toEqual(p);
  });

  it('fills in whatever is missing from the default building', () => {
    const read = ok(checkProject({ form: { length: 200 } }));
    expect(read.form).toEqual({ ...DEFAULT_FORM_STATE, length: 200 });
    expect(read.boardSize).toBeNull();
  });

  it('ignores fields it does not know, so a newer file still opens', () => {
    const read = ok(checkProject({ version: 99, form: { length: 200, solarPanels: true }, colour: 'red' }));
    expect(read.form.length).toBe(200);
    expect('solarPanels' in read.form).toBe(false);
  });

  it('covers every FormState field — a new one must not be dropped on load', () => {
    // Each field given a value that differs from its default must come back.
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(DEFAULT_FORM_STATE)) {
      changed[key] = typeof value === 'number' ? value + 1 : typeof value === 'boolean' ? !value : value;
    }
    Object.assign(changed, {
      projectName: 'x',
      aBasis: 'shortestEdge',
      roofType: 'monoslope',
      ridgeAlong: 'width',
      monoslopeHighSide: 'widthNear',
      stepEdge: 'lengthNear',
    });
    const read = ok(checkProject({ form: changed }));
    for (const key of Object.keys(DEFAULT_FORM_STATE)) {
      expect(read.form[key as keyof typeof read.form], key).not.toEqual(
        DEFAULT_FORM_STATE[key as keyof typeof DEFAULT_FORM_STATE]
      );
    }
  });

  const refused: Array<[string, unknown, RegExp]> = [
    ['not an object', 'hello', /not a project/],
    ['an array', [], /not a project/],
    ['null', null, /not a project/],
    ['another app’s file', { app: 'something-else', form: {} }, /not a Wind Zone Visualizer/],
    ['no form', { boardSize: 4 }, /no building/],
    ['a number as text', { form: { length: '120' } }, /length/],
    ['NaN', { form: { width: NaN } }, /width/],
    ['infinity', { form: { eaveHeight: Infinity } }, /eaveHeight/],
    ['a negative length', { form: { length: -5 } }, /length/],
    ['an absurd length', { form: { length: 1e12 } }, /length/],
    ['an unknown roof type', { form: { roofType: 'dome' } }, /roofType/],
    ['a choice that is not text', { form: { stepEdge: 3 } }, /stepEdge/],
    ['a flag that is not a flag', { form: { stepEnabled: 'yes' } }, /stepEnabled/],
    ['a name that is not text', { form: { projectName: 42 } }, /projectName/],
    ['a zero board size', { form: {}, boardSize: 0 }, /boardSize/],
    ['a board size as text', { form: {}, boardSize: '4' }, /boardSize/],
  ];
  for (const [what, raw, pattern] of refused) {
    it(`refuses ${what}, naming what is wrong`, () => {
      expect(errorOf(checkProject(raw))).toMatch(pattern);
    });
  }

  it('accepts the half-typed values the form itself can produce', () => {
    // The autosave records these; refusing them would throw the rest away.
    expect(ok(checkProject({ form: { length: 0, pitchDegrees: 95 } })).form.length).toBe(0);
  });

  it('cuts an overlong name rather than refusing the building', () => {
    expect(ok(checkProject({ form: { projectName: 'x'.repeat(5000) } })).form.projectName).toHaveLength(200);
  });
});

describe('project files', () => {
  it('round-trips every kind of building', () => {
    for (const [name, overrides] of Object.entries(BUILDINGS)) {
      const p = project({ ...overrides, projectName: name }, name === 'flat' ? 4 : null);
      expect(ok(parseProject(serializeProject(p))), name).toEqual(p);
    }
  });

  it('says so when the file is not JSON', () => {
    expect(errorOf(parseProject('%PDF-1.4'))).toMatch(/not a project file/);
  });

  it('names the file after the project', () => {
    expect(projectFileName(project({ projectName: '  Warehouse B / Phase 2 ' }))).toBe('warehouse-b-phase-2.zones.json');
    expect(projectFileName(project())).toBe('wind-zones.zones.json');
  });
});

describe('share links', () => {
  it('the default building is an empty fragment', () => {
    expect(projectToFragment(DEFAULT_PROJECT)).toBe('');
  });

  it('lists only what differs from the default, under the fields’ own names', () => {
    expect(projectToFragment(project({ length: 200, roofType: 'gable' }))).toBe('length=200&roofType=gable');
  });

  it('round-trips every kind of building', () => {
    for (const [name, overrides] of Object.entries(BUILDINGS)) {
      const p = project(overrides, name === 'gable20' ? 8 : null);
      // The default building is an empty fragment, which reads as "no link".
      const read = projectFromFragment(projectToFragment(p));
      expect(read ? ok(read) : DEFAULT_PROJECT, name).toEqual(p);
    }
  });

  it('round-trips a project name with spaces, symbols and non-Latin letters', () => {
    const p = project({ projectName: 'Lagerhalle Süd & Büro #2 — 50% = fertig?' });
    const fragment = projectToFragment(p);
    expect(fragment).not.toMatch(/[\s#]/);
    expect(ok(projectFromFragment(`#${fragment}`))).toEqual(p);
  });

  it('keeps decimals and flags exactly', () => {
    const p = project({ eaveHeight: 22.375, stepEnabled: true, stepOffset: 12.5 }, 0.5);
    expect(ok(projectFromFragment(projectToFragment(p)))).toEqual(p);
  });

  it('takes no interest in a fragment that is not ours', () => {
    expect(projectFromFragment('')).toBeNull();
    expect(projectFromFragment('#')).toBeNull();
    expect(projectFromFragment('#section-2')).toBeNull();
    expect(projectFromFragment('#utm_source=newsletter')).toBeNull();
  });

  it('refuses a hand-edited link with a bad value instead of guessing', () => {
    expect(errorOf(projectFromFragment('#length=wide'))).toMatch(/length/);
    expect(errorOf(projectFromFragment('#length='))).toMatch(/length/);
    expect(errorOf(projectFromFragment('#roofType=dome'))).toMatch(/roofType/);
    expect(errorOf(projectFromFragment('#stepEnabled=yes'))).toMatch(/stepEnabled/);
    expect(errorOf(projectFromFragment('#boardSize=abc'))).toMatch(/boardSize/);
  });
});
