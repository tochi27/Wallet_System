const { createDefaultPreset } = require("ts-jest");

/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleFileExtensions: ["ts", "js", "json", "node"],
  roots: ["<rootDir>/src/tests"],
  testMatch: [
    "**/tests/**/*.test.ts",
    "**/tests/**/*.spec.ts",
  ],
};
