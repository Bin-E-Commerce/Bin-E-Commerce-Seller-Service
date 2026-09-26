// Cấu hình Jest cho unit test Seller Service, đồng nhất alias với TypeScript build.
module.exports = {
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: '.',
    testRegex: '.*\\.spec\\.ts$',
    transform: { '^.+\\.(t|j)s$': 'ts-jest' },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@common/(.*)$': '<rootDir>/../../packages/common/$1',
    },
    testEnvironment: 'node',
};
