import { describe, expect, it } from 'vitest';
import { normalizeSubject } from '@shared/core/merge/subjectKey';

describe('normalizeSubject', () => {
  it('collapses variants of the same subject to one slug', () => {
    expect(normalizeSubject('Алгебра')).toBe('algebra');
    expect(normalizeSubject('Алгебра та початки аналізу')).toBe('algebra');
    expect(normalizeSubject('АЛГЕБРА')).toBe('algebra');
  });

  it('strips bracketed qualifiers and class suffixes', () => {
    expect(normalizeSubject('Геометрія (10-А)')).toBe('geometry');
    expect(normalizeSubject('Фізика 10-Б')).toBe('physics');
  });

  it('matches Ukrainian and English names to the same slug', () => {
    expect(normalizeSubject('Англійська мова')).toBe('english');
    expect(normalizeSubject('English')).toBe('english');
  });

  it('separates the two history subjects', () => {
    expect(normalizeSubject('Історія України')).toBe('history-ukraine');
    expect(normalizeSubject('Всесвітня історія')).toBe('history-world');
  });

  it('separates the two Ukrainian subjects', () => {
    expect(normalizeSubject('Українська мова')).toBe('ukrainian-language');
    expect(normalizeSubject('Українська література')).toBe('ukrainian-literature');
    expect(normalizeSubject('Укр. мова')).toBe('ukrainian-language');
  });

  it('lets a user alias win over the built-in dictionary', () => {
    expect(normalizeSubject('Математика', { 'математика': 'algebra' })).toBe('algebra');
  });

  it('falls back to a slug for unknown subjects rather than losing them', () => {
    expect(normalizeSubject('Основи здоров’я')).toBe('osnovy-zdorovia');
  });

  it('handles empty and whitespace input', () => {
    expect(normalizeSubject('')).toBe('unknown');
    expect(normalizeSubject('   ')).toBe('unknown');
  });
});
