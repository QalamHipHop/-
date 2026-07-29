import { render, buildBody } from './template';

describe('template', () => {
  it('replaces simple variables', () => {
    expect(render('Hello {{name}}!', { name: 'Qalam' })).toBe('Hello Qalam!');
  });

  it('handles nested keys', () => {
    expect(render('Hi {{user.name}}', { user: { name: 'A' } })).toBe('Hi A');
  });

  it('returns empty string for missing keys', () => {
    expect(render('Hi {{x}}', {})).toBe('Hi ');
  });

  it('buildBody substitutes subject and body', () => {
    const out = buildBody(
      { subject: 'Welcome {{name}}', body: 'Hi {{name}}!' },
      { name: 'A' },
    );
    expect(out.subject).toBe('Welcome A');
    expect(out.body).toBe('Hi A!');
  });
});
