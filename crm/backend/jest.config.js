/**
 * Тесты чистой логики: права доступа, расчёт цены, границы периодов.
 *
 * Базы данных здесь нет намеренно. Всё, что покрыто, — функции без побочных
 * эффектов, и именно на них держатся деньги компании и разграничение доступа.
 * Такой набор гоняется одной командой на любой машине, без Postgres и Docker.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!**/*.module.ts'],
};
